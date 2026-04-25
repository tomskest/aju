/**
 * Tigris bucket + access-key administration.
 *
 * Used by two entry points:
 *   - `src/lib/tenant-provision.ts` — auto-provisions storage at signup
 *     using admin credentials from env (`TIGRIS_STORAGE_ACCESS_KEY_ID` +
 *     `TIGRIS_STORAGE_SECRET_ACCESS_KEY`). The admin key must carry
 *     org-wide admin role so it can create buckets and mint new scoped
 *     keys. Generate it with:
 *       tigris access-keys create aju-railway-admin
 *       tigris access-keys assign <id> --admin
 *
 *   - `scripts/provision-tigris-bucket.ts` — operator-led backfill /
 *     re-provision. Runs on a machine already authenticated via
 *     `tigris login`, so no explicit creds are passed; the CLI picks
 *     up the OAuth session from `~/.tigris/config.json`.
 *
 * The runtime shells out to the `tigris` CLI (shipped as a dep in
 * `node_modules/.bin/tigris`) rather than hitting Tigris's gRPC IAM/MGMT
 * APIs directly, since no current TypeScript SDK is published.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { encryptStorageSecret } from "./crypto";

export interface TigrisAdminCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export type ProvisionStorageResult = {
  bucket: string;
  /**
   * `true` when this call actually created the bucket and minted a key;
   * `false` on idempotent no-op (tenant row already fully populated).
   */
  created: boolean;
};

const DEFAULT_BUCKET_LOCATIONS = "fra";

function bucketNameFor(orgId: string): string {
  if (!/^[a-z0-9]{6,50}$/.test(orgId)) {
    throw new Error(
      `tigris-admin: orgId ${orgId} is not cuid-shaped — refusing to derive bucket name`,
    );
  }
  return `aju-${orgId}`;
}

function cliPath(): string {
  // Resolve from the app's own node_modules so Railway and local both work.
  return join(process.cwd(), "node_modules", ".bin", "tigris");
}

function runCli(
  args: string[],
  creds?: TigrisAdminCredentials,
): string {
  // Build a clean env: the CLI reads TIGRIS_STORAGE_ACCESS_KEY_ID /
  // TIGRIS_STORAGE_SECRET_ACCESS_KEY (Tigris-specific), AWS_ACCESS_KEY_ID /
  // AWS_SECRET_ACCESS_KEY (S3-compat fallback), and AWS_ENDPOINT_URL_*
  // overrides. When the legacy shared-bucket fallback is still configured
  // on the runtime, those AWS_* vars collide with the Tigris admin key we
  // want to use and the CLI's provisioning operations target the wrong
  // principal or endpoint — producing stdout like `Bucket 'x' created`
  // while no bucket actually lands in our Tigris org. Scrub the lot so
  // only TIGRIS_STORAGE_* creds reach the subprocess.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith("AWS_")) delete env[k];
  }
  if (creds) {
    env.TIGRIS_STORAGE_ACCESS_KEY_ID = creds.accessKeyId;
    env.TIGRIS_STORAGE_SECRET_ACCESS_KEY = creds.secretAccessKey;
  }
  // Operator-led path (no TIGRIS_STORAGE_* creds) relies on the CLI's
  // OAuth session (~/.tigris/config.json); no throw here.
  const res = spawnSync(cliPath(), args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const stderr = (res.stderr ?? "").toString().trim();
    throw new TigrisCliError(
      `tigris ${args.join(" ")} exited ${res.status}: ${stderr || "(no stderr)"}`,
      stderr,
    );
  }
  return (res.stdout ?? "").toString();
}

export class TigrisCliError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.name = "TigrisCliError";
    this.stderr = stderr;
  }
}

export function createBucket(
  bucket: string,
  locations: string,
  creds?: TigrisAdminCredentials,
): void {
  try {
    runCli(["mk", bucket, "--locations", locations], creds);
  } catch (err) {
    // Idempotent resume: a bucket we already own is a no-op, not a failure.
    // Tigris returns `The requested bucket name is not available` for any
    // duplicate (whether we own it or not — global namespace). Check
    // ownership-by-us via `tigris stat` before swallowing; otherwise a
    // genuine collision with someone else's bucket would silently pass.
    // The --locations flag only applies at creation time; an existing
    // bucket's location is not mutated silently here.
    if (
      err instanceof TigrisCliError &&
      /already exists|BucketAlreadyOwnedByYou|not available/i.test(err.stderr)
    ) {
      try {
        runCli(["stat", bucket], creds);
        // stat succeeded → we own it → idempotent no-op.
        return;
      } catch {
        // stat failed → not ours, original error is the right one.
        throw err;
      }
    }
    throw err;
  }
}

export function createAccessKey(
  name: string,
  creds?: TigrisAdminCredentials,
): { id: string; secret: string } {
  const out = runCli(["access-keys", "create", "--json", name], creds);
  const parsed = JSON.parse(out) as { id?: string; secret?: string };
  if (!parsed.id || !parsed.secret) {
    throw new Error(`tigris access-keys create returned no id/secret: ${out}`);
  }
  return { id: parsed.id, secret: parsed.secret };
}

export function assignAccessKeyToBucket(
  keyId: string,
  bucket: string,
  role: "Editor" | "ReadOnly",
  creds?: TigrisAdminCredentials,
): void {
  runCli(
    [
      "access-keys",
      "assign",
      keyId,
      "--bucket",
      bucket,
      "--role",
      role,
      "-y",
      "--json",
    ],
    creds,
  );
}

export function deleteBucket(
  bucket: string,
  creds?: TigrisAdminCredentials,
): void {
  // `-rf` drops bucket contents + the bucket itself. Safe here because the
  // caller (org deletion) already wiped the known objects via vaultFile.s3Key
  // and anything left is orphan data.
  runCli(["rm", `t3://${bucket}`, "-rf"], creds);
}

export function deleteAccessKey(
  keyId: string,
  creds?: TigrisAdminCredentials,
): void {
  runCli(["access-keys", "delete", keyId, "-y"], creds);
}

function envAdminCredentials(): TigrisAdminCredentials | null {
  const id = process.env.TIGRIS_STORAGE_ACCESS_KEY_ID;
  const secret = process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY;
  if (!id || !secret) return null;
  return { accessKeyId: id, secretAccessKey: secret };
}

/**
 * End-to-end: create a per-tenant bucket, mint an Editor-scoped access
 * key bound only to that bucket, encrypt the id + secret, and write them
 * to the `tenant` row. Idempotent — a tenant row that already has all
 * three storage fields populated is a no-op; a row with only `bucket`
 * set (partial provision from a prior failed attempt) re-mints the key
 * and overwrites the encrypted columns.
 *
 * If `creds` is omitted, the function reads `TIGRIS_STORAGE_ACCESS_KEY_ID`
 * and `TIGRIS_STORAGE_SECRET_ACCESS_KEY` from env. When both env and
 * explicit creds are absent, falls back to the CLI's OAuth session
 * (useful for operator-machine runs of scripts/provision-tigris-bucket.ts).
 */
/**
 * Best-effort cleanup of Tigris state during org deletion: delete the
 * scoped access key (so it can't be used again) and delete the bucket
 * (so the slot is reclaimable and stops billing). Reads the tenant row
 * for bucket/key metadata and decrypts the stored scoped-key id; the
 * id alone is enough to delete the key (we don't need the secret).
 *
 * Returns warnings on partial failures instead of throwing — org
 * deletion should not be blocked by storage-side cleanup glitches. The
 * caller logs anything returned here.
 */
export async function destroyTenantStorage(
  prisma: PrismaClient,
  orgId: string,
  options: { creds?: TigrisAdminCredentials } = {},
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const creds = options.creds ?? envAdminCredentials() ?? undefined;

  const tenant = await prisma.tenant.findUnique({
    where: { organizationId: orgId },
    select: {
      storageBucket: true,
      storageAccessKeyEnc: true,
    },
  });
  if (!tenant) return { warnings };

  if (tenant.storageAccessKeyEnc) {
    try {
      const { decryptStorageSecret } = await import("./crypto");
      const keyId = decryptStorageSecret(tenant.storageAccessKeyEnc);
      deleteAccessKey(keyId, creds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`tigris access-key delete failed: ${msg}`);
    }
  }

  if (tenant.storageBucket) {
    try {
      deleteBucket(tenant.storageBucket, creds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`tigris bucket delete failed: ${msg}`);
    }
  }

  return { warnings };
}

export async function provisionTenantStorage(
  prisma: PrismaClient,
  orgId: string,
  options: {
    creds?: TigrisAdminCredentials;
    locations?: string;
  } = {},
): Promise<ProvisionStorageResult> {
  const locations =
    options.locations ||
    process.env.TIGRIS_BUCKET_LOCATIONS ||
    DEFAULT_BUCKET_LOCATIONS;
  const creds = options.creds ?? envAdminCredentials() ?? undefined;

  const tenant = await prisma.tenant.findUnique({
    where: { organizationId: orgId },
    select: {
      organizationId: true,
      status: true,
      storageBucket: true,
      storageAccessKeyEnc: true,
      storageSecretKeyEnc: true,
    },
  });
  if (!tenant) throw new Error(`no tenant row for org ${orgId}`);

  if (
    tenant.storageBucket &&
    tenant.storageAccessKeyEnc &&
    tenant.storageSecretKeyEnc
  ) {
    return { bucket: tenant.storageBucket, created: false };
  }

  const bucket = tenant.storageBucket || bucketNameFor(orgId);
  createBucket(bucket, locations, creds);

  const key = createAccessKey(bucket, creds);
  assignAccessKeyToBucket(key.id, bucket, "Editor", creds);

  await prisma.tenant.update({
    where: { organizationId: orgId },
    data: {
      storageBucket: bucket,
      storageAccessKeyEnc: encryptStorageSecret(key.id),
      storageSecretKeyEnc: encryptStorageSecret(key.secret),
    },
  });

  return { bucket, created: true };
}
