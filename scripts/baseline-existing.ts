/**
 * One-shot baseline script for the transition from `db push` to formal
 * Prisma migrations. Run this ONCE against production before the first
 * `npm start` with the new code, then delete — it won't be needed again.
 *
 *   # From local shell (needs DATABASE_URL + TENANT_DSN_ENC_KEY set to prod values):
 *   npx tsx scripts/baseline-existing.ts
 *
 *   # Or from Railway shell on the aju service (env already populated):
 *   npx tsx scripts/baseline-existing.ts
 *
 * The script marks the `20260422000000_init` migration as applied on the
 * control DB and on every active tenant DB, creating the `_prisma_migrations`
 * bookkeeping table where needed. It's idempotent: already-baselined DBs
 * are detected via a direct SQL check and skipped.
 *
 * After this runs cleanly, the normal `npm start` path (migrate deploy +
 * tenant-migrate.ts + next start) proceeds without P3005.
 */
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { prisma } from "../src/lib/db";
import { decryptDsn } from "../src/lib/tenant";

const CONTROL_BASELINE = "20260422000000_init";
const TENANT_BASELINE = "20260422000000_init";

async function isAlreadyBaselined(
  dsn: string,
  migrationName: string,
): Promise<boolean> {
  const client = new Client({ connectionString: dsn });
  try {
    await client.connect();
    const tableCheck = await client.query(
      `SELECT to_regclass('public._prisma_migrations') AS reg`,
    );
    if (!tableCheck.rows[0].reg) return false;
    const res = await client.query(
      `SELECT migration_name FROM _prisma_migrations
         WHERE migration_name = $1 AND finished_at IS NOT NULL`,
      [migrationName],
    );
    return res.rows.length > 0;
  } finally {
    await client.end();
  }
}

function resolveBaseline(
  dsn: string,
  schemaPath: string,
  migrationName: string,
): void {
  // Set both DATABASE_URL and TENANT_DATABASE_URL — the control schema reads
  // the former, the tenant schema the latter. Easier than branching on path.
  const r = spawnSync(
    "npx",
    [
      "prisma",
      "migrate",
      "resolve",
      "--schema",
      schemaPath,
      "--applied",
      migrationName,
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: dsn,
        TENANT_DATABASE_URL: dsn,
      },
      stdio: "inherit",
    },
  );
  if (r.status !== 0) {
    throw new Error(`prisma migrate resolve failed for ${migrationName}`);
  }
}

async function main() {
  const controlDsn = process.env.DATABASE_URL;
  if (!controlDsn) throw new Error("DATABASE_URL required (control DSN)");

  console.log("=== control DB ===");
  if (await isAlreadyBaselined(controlDsn, CONTROL_BASELINE)) {
    console.log(`control already baselined (${CONTROL_BASELINE}) — skipping`);
  } else {
    resolveBaseline(
      controlDsn,
      "data/control/schema.prisma",
      CONTROL_BASELINE,
    );
    console.log(`control baselined as applied: ${CONTROL_BASELINE}`);
  }

  const tenants = await prisma.tenant.findMany({
    where: { status: "active" },
    select: {
      organizationId: true,
      databaseName: true,
      dsnDirectEnc: true,
    },
  });
  console.log(`\n=== ${tenants.length} active tenant DB(s) ===`);

  let baselined = 0;
  let skipped = 0;
  for (const t of tenants) {
    const dsn = decryptDsn(t.dsnDirectEnc);
    if (await isAlreadyBaselined(dsn, TENANT_BASELINE)) {
      console.log(`${t.databaseName}: already baselined — skipping`);
      skipped++;
      continue;
    }
    resolveBaseline(dsn, "data/tenant/schema.prisma", TENANT_BASELINE);
    console.log(`${t.databaseName}: baselined as applied`);
    baselined++;
  }

  await prisma.$disconnect();
  console.log(
    `\ndone — ${baselined} tenant(s) baselined, ${skipped} already up-to-date`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
