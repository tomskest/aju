/**
 * Operator-led Tigris bucket provisioning / backfill.
 *
 * Run on a machine whose `tigris` CLI is authenticated via `tigris login`
 * (OAuth). The runtime auto-provisions on signup when
 * `TIGRIS_STORAGE_ACCESS_KEY_ID` is set in env (see
 * `src/lib/tenant-provision.ts`); this script covers the offline cases:
 *   - backfilling existing tenants created before storage provisioning
 *     landed,
 *   - re-provisioning a tenant whose key was rotated or bucket lost.
 *
 * Usage:
 *   npx tsx scripts/provision-tigris-bucket.ts <orgId>
 *   npx tsx scripts/provision-tigris-bucket.ts --all
 *   npx tsx scripts/provision-tigris-bucket.ts <orgId> --dry-run
 *
 * Idempotent via `provisionTenantStorage` — tenants that already have all
 * three storage columns populated are skipped; partial rows are resumed.
 *
 * Required env:
 *   DATABASE_URL          — control DB (direct DSN)
 *   STORAGE_CRED_ENC_KEY  — AES-GCM key for storage creds (see
 *                           src/lib/storage-crypto.ts)
 *
 * Optional env:
 *   TIGRIS_BUCKET_LOCATIONS  — PoP code(s) pinning data residency.
 *                              Defaults to `fra`. Overriding examples:
 *                              `fra,ams` (in-EU redundancy), `global`
 *                              (replicated default). Valid single-region
 *                              codes: ams, fra, gru, iad, jnb, lhr, nrt,
 *                              ord, sin, sjc, syd.
 *
 * On PATH:
 *   tigris                — authenticated via `tigris login`. No explicit
 *                           creds are passed by this script, so the CLI
 *                           uses its cached OAuth session.
 */
import { prisma } from "../src/lib/db";
import { provisionTenantStorage } from "../src/lib/storage";

type CliArgs = {
  all: boolean;
  dryRun: boolean;
  orgId: string | null;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { all: false, dryRun: false, orgId: null };
  for (const a of argv) {
    if (a === "--all") out.all = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--")) {
      throw new Error(`unknown flag: ${a}`);
    } else if (!out.orgId) {
      out.orgId = a;
    } else {
      throw new Error(`unexpected positional arg: ${a}`);
    }
  }
  if (!out.all && !out.orgId) {
    throw new Error("provide <orgId> or --all");
  }
  return out;
}

async function provisionOne(orgId: string, dryRun: boolean): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { organizationId: orgId },
    select: {
      status: true,
      storageBucket: true,
      storageAccessKeyEnc: true,
      storageSecretKeyEnc: true,
    },
  });
  if (!tenant) {
    throw new Error(`no tenant row for org ${orgId}`);
  }
  if (tenant.status !== "active") {
    throw new Error(
      `tenant ${orgId} status is ${tenant.status}, refusing to provision`,
    );
  }
  if (
    tenant.storageBucket &&
    tenant.storageAccessKeyEnc &&
    tenant.storageSecretKeyEnc
  ) {
    console.log(
      `org ${orgId}: already provisioned (bucket=${tenant.storageBucket}) — skipping`,
    );
    return;
  }

  console.log(`org ${orgId}:`);
  if (dryRun) {
    console.log("  (dry-run) would create bucket + scoped key + write tenant row");
    return;
  }

  const result = await provisionTenantStorage(prisma, orgId);
  console.log(`  bucket:  ${result.bucket}`);
  console.log(`  created: ${result.created ? "yes" : "resumed"}`);
  console.log(`  tenant row updated`);
}

async function provisionAll(dryRun: boolean): Promise<void> {
  const rows = await prisma.tenant.findMany({
    where: { status: "active", storageBucket: null },
    select: { organizationId: true },
  });
  console.log(`found ${rows.length} tenant(s) needing provisioning`);
  for (const r of rows) {
    try {
      await provisionOne(r.organizationId, dryRun);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED: ${msg}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.all) {
    await provisionAll(args.dryRun);
  } else if (args.orgId) {
    await provisionOne(args.orgId, args.dryRun);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
