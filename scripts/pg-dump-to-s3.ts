/**
 * pg_dump → S3 backup job.
 *
 * Complements Neon's per-branch PITR with per-database dumps so a single
 * tenant can be restored in isolation without reverting all others. Iterates
 * every `active` tenant (plus the control plane), streams `pg_dump
 * --format=custom` stdout directly into a multipart S3 `Upload`, and records
 * a JSON summary at the end.
 *
 * Run:
 *   npm run backup:pg-dump
 *
 * Required env:
 *   DATABASE_URL           control-plane direct DSN
 *   TENANT_DSN_ENC_KEY     to decrypt tenant direct DSNs
 *   AWS_DEFAULT_REGION     plus AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 *                          (or role creds from the runner)
 *   BACKUP_S3_BUCKET       target bucket
 *   BACKUP_S3_PREFIX       key prefix (e.g. "backups")
 *
 * Optional env:
 *   BACKUP_S3_KMS_KEY_ID   SSE-KMS key id; when unset the upload falls back
 *                          to SSE-S3 (AES256)
 *   AWS_ENDPOINT_URL       non-AWS S3 endpoints (MinIO, Railway Bucket, …)
 *
 * Exit code is 1 if any tenant (including control) fails. Streaming is
 * mandatory — a single tenant dump can be many GB and must never be buffered
 * in memory.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { prisma } from "../src/lib/db";
import { decryptDsn } from "../src/lib/tenant";

type TargetKind = "control" | "tenant";

interface Target {
  kind: TargetKind;
  /** Synthetic `control` or the real organizationId. Used in the S3 key. */
  organizationId: string;
  /** Plaintext direct DSN. Never logged. */
  dsn: string;
}

interface Result {
  kind: TargetKind;
  organizationId: string;
  ok: boolean;
  bytes: number;
  durationMs: number;
  /** Redacted key — never include the full tenant path at info level. */
  keyHashSuffix: string;
  error?: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function redactKeySuffix(key: string): string {
  // Keep only the trailing filename for info-level logs; the per-tenant
  // segment stays out of cleartext logs.
  const parts = key.split("/");
  return parts[parts.length - 1] ?? "";
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yyyy = now.getUTCFullYear();
  const mm = pad(now.getUTCMonth() + 1);
  const dd = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mi = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}${mi}${ss}`;
}

async function collectTargets(): Promise<Target[]> {
  const targets: Target[] = [];

  const controlDsn = requireEnv("DATABASE_URL");
  targets.push({
    kind: "control",
    organizationId: "control",
    dsn: controlDsn,
  });

  const tenants = await prisma.tenant.findMany({
    where: { status: "active" },
    select: { organizationId: true, dsnDirectEnc: true },
  });

  for (const t of tenants) {
    try {
      const dsn = decryptDsn(t.dsnDirectEnc);
      targets.push({
        kind: "tenant",
        organizationId: t.organizationId,
        dsn,
      });
    } catch (err) {
      // Surface as a failure in the summary rather than silently skipping.
      // We still push a target with an empty DSN; dumpOne handles it.
      console.error(
        `[backup] could not decrypt DSN for tenant`,
        { orgId: t.organizationId, error: String(err instanceof Error ? err.message : err) },
      );
      targets.push({
        kind: "tenant",
        organizationId: t.organizationId,
        dsn: "",
      });
    }
  }

  return targets;
}

function buildS3Client(): S3Client {
  return new S3Client({
    region: process.env.AWS_DEFAULT_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL || undefined,
    // forcePathStyle helps with MinIO / Railway-bucket style endpoints; it's
    // a no-op against real AWS S3 when endpoint is unset.
    forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL),
  });
}

async function dumpOne(
  s3: S3Client,
  bucket: string,
  prefix: string,
  kmsKeyId: string | undefined,
  target: Target,
  stamp: string,
): Promise<Result> {
  const start = Date.now();
  const key = `${prefix.replace(/\/+$/, "")}/${target.organizationId}/${stamp}.dump`;
  const keyHashSuffix = redactKeySuffix(key);

  if (!target.dsn) {
    return {
      kind: target.kind,
      organizationId: target.organizationId,
      ok: false,
      bytes: 0,
      durationMs: Date.now() - start,
      keyHashSuffix,
      error: "missing DSN",
    };
  }

  // Spawn pg_dump — custom format is compact and lets pg_restore do partial
  // restores. --no-owner / --no-privileges make the dump portable across
  // ownerships; production restores should re-apply GRANTs separately.
  const child = spawn(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--dbname=${target.dsn}`,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let bytes = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
  });

  // Capture stderr so a failed dump tells us why. pg_dump writes progress +
  // warnings to stderr in normal runs — keep it bounded.
  let stderrBuf = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderrBuf.length < 16_000) {
      stderrBuf += chunk;
    }
  });

  const uploadParams: ConstructorParameters<typeof Upload>[0] = {
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: child.stdout,
      ContentType: "application/octet-stream",
      ServerSideEncryption: kmsKeyId ? "aws:kms" : "AES256",
      ...(kmsKeyId ? { SSEKMSKeyId: kmsKeyId } : {}),
    },
  };

  const upload = new Upload(uploadParams);

  // Wait for pg_dump to exit; the Upload promise only settles once the
  // stream is closed (successfully or otherwise).
  const dumpExit = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });

  try {
    const [exitCode] = await Promise.all([dumpExit, upload.done()]);
    if (exitCode !== 0) {
      return {
        kind: target.kind,
        organizationId: target.organizationId,
        ok: false,
        bytes,
        durationMs: Date.now() - start,
        keyHashSuffix,
        error: `pg_dump exited with code ${exitCode}: ${stderrBuf.trim().slice(-400)}`,
      };
    }
    return {
      kind: target.kind,
      organizationId: target.organizationId,
      ok: true,
      bytes,
      durationMs: Date.now() - start,
      keyHashSuffix,
    };
  } catch (err) {
    // Make a best-effort attempt to kill pg_dump so we don't leave stragglers.
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    return {
      kind: target.kind,
      organizationId: target.organizationId,
      ok: false,
      bytes,
      durationMs: Date.now() - start,
      keyHashSuffix,
      error: String(err instanceof Error ? err.message : err),
    };
  }
}

async function main(): Promise<void> {
  const bucket = requireEnv("BACKUP_S3_BUCKET");
  const prefix = process.env.BACKUP_S3_PREFIX || "backups";
  const kmsKeyId = process.env.BACKUP_S3_KMS_KEY_ID || undefined;

  const s3 = buildS3Client();
  const targets = await collectTargets();
  const stamp = timestamp();

  console.log(
    JSON.stringify({
      event: "backup.start",
      targetCount: targets.length,
      bucket,
      // Don't log the prefix with tenant ids — prefix itself is fine.
      prefix,
      kmsEnabled: Boolean(kmsKeyId),
      stamp,
    }),
  );

  const results: Result[] = [];
  for (const target of targets) {
    const r = await dumpOne(s3, bucket, prefix, kmsKeyId, target, stamp);
    results.push(r);
    // Info log intentionally omits the full key / org id. Debug callers
    // who need that can turn up the pg_dump stderr capture.
    console.log(
      JSON.stringify({
        event: r.ok ? "backup.target.ok" : "backup.target.fail",
        kind: r.kind,
        // Tenant-scoped org ids leak customer identity into the log;
        // emit a short fingerprint in info logs and the real id only in the
        // final summary (which runners typically pipe to their own
        // structured log store).
        orgFingerprint: r.organizationId.slice(0, 6),
        bytes: r.bytes,
        durationMs: r.durationMs,
        keyFile: r.keyHashSuffix,
        ...(r.error ? { errorHint: r.error.slice(0, 120) } : {}),
      }),
    );
  }

  const failed = results.filter((r) => !r.ok);
  const summary = {
    event: "backup.summary",
    stamp,
    total: results.length,
    ok: results.length - failed.length,
    failed: failed.length,
    totalBytes: results.reduce((n, r) => n + r.bytes, 0),
    results: results.map((r) => ({
      kind: r.kind,
      organizationId: r.organizationId,
      ok: r.ok,
      bytes: r.bytes,
      durationMs: r.durationMs,
      ...(r.error ? { error: r.error } : {}),
    })),
  };
  console.log(JSON.stringify(summary, null, 2));

  await prisma.$disconnect();

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(
    JSON.stringify({
      event: "backup.fatal",
      error: String(err instanceof Error ? err.message : err),
    }),
  );
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
