/**
 * Apply tenant schema migrations to every active tenant database.
 *
 * Runs in CI after every deploy that touches data/tenant/. For each
 * active tenant:
 *   1. Acquire advisory lock on hashtext('tenant-migrate:' || db_name).
 *   2. Shell out to `prisma migrate deploy --schema data/tenant/schema.prisma`
 *      with TENANT_DATABASE_URL=<direct DSN>. This is a no-op if the tenant
 *      DB is already up to date.
 *   3. Re-apply vector-setup.sql, fts-setup/*.sql, rls-policies.sql
 *      (all idempotent). These live outside Prisma's management because they
 *      define extensions, triggers, and RLS policies Prisma can't model.
 *   4. Update tenant.schema_version + last_migrated_at.
 *
 * On failure the tenant's schema_version is left untouched and the error is
 * logged. Request paths will flip that tenant into read-only mode via the
 * schema-drift check in src/lib/tenant-context.ts.
 *
 * One-time baselining for existing production tenants: before shipping code
 * that uses `migrate deploy`, the operator must run once per tenant DB:
 *   DATABASE_URL=<tenant direct DSN> \
 *     npx prisma migrate resolve --schema data/tenant/schema.prisma \
 *     --applied 20260422000000_init
 * so Prisma's _prisma_migrations table records the baseline as applied.
 *
 * Also handles the dev-mode USE_LOCAL_TENANT_DB=1 fallback: when set, applies
 * the tenant schema to the control DB alongside the control schema, so local
 * one-DB dev keeps working.
 */

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { decryptDsn } from "../src/lib/tenant";
import { CURRENT_TENANT_SCHEMA_VERSION } from "../src/lib/tenant";

const TENANT_SETUP_FILES = [
  "data/tenant/vector-setup.sql",
  "data/tenant/fts-setup/migration.sql",
  "data/tenant/fts-setup/files-fts.sql",
  "data/tenant/rls-policies.sql",
];

async function main(): Promise<void> {
  if (process.env.USE_LOCAL_TENANT_DB === "1") {
    await runLocalMode();
    return;
  }

  const prisma = new PrismaClient();
  let okCount = 0;
  let errCount = 0;
  try {
    const tenants = await prisma.tenant.findMany({
      where: { status: "active" },
      select: {
        id: true,
        organizationId: true,
        databaseName: true,
        dsnDirectEnc: true,
        schemaVersion: true,
      },
    });
    console.log(`[tenant-migrate] ${tenants.length} active tenant(s) to migrate`);

    for (const tenant of tenants) {
      const dsn = decryptDsn(tenant.dsnDirectEnc);
      try {
        await withAdvisoryLock(dsn, `tenant-migrate:${tenant.databaseName}`, async () => {
          await runPrismaDeploy(dsn);
          await applySetupSql(dsn);
        });
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            schemaVersion: CURRENT_TENANT_SCHEMA_VERSION,
            lastMigratedAt: new Date(),
          },
        });
        okCount += 1;
        console.log(`[tenant-migrate] ✓ ${tenant.databaseName}`);
      } catch (err) {
        errCount += 1;
        console.error(`[tenant-migrate] ✗ ${tenant.databaseName}:`, err);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    `[tenant-migrate] done: ${okCount} ok, ${errCount} failed, target schema v${CURRENT_TENANT_SCHEMA_VERSION}`,
  );
  if (errCount > 0) process.exit(1);
}

async function runLocalMode(): Promise<void> {
  const dsn = process.env.DATABASE_URL;
  if (!dsn) {
    console.log(
      "[tenant-migrate] USE_LOCAL_TENANT_DB=1 but DATABASE_URL is not set — skipping",
    );
    return;
  }
  console.log(
    "[tenant-migrate] USE_LOCAL_TENANT_DB=1 — applying tenant schema to control DB",
  );
  await runPrismaDeploy(dsn);
  await applySetupSql(dsn);
  console.log("[tenant-migrate] local-mode done");
}

async function runPrismaDeploy(dsn: string): Promise<void> {
  // `prisma migrate deploy` uses the same env var as the datasource block
  // (TENANT_DATABASE_URL) and will no-op if _prisma_migrations already shows
  // every migration as applied. For DBs that pre-date Prisma migrations,
  // the operator must run `prisma migrate resolve --applied 20260422000000_init`
  // once to baseline — see the docstring at the top of this file.
  const res = spawnSync(
    "npx",
    [
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      "data/tenant/schema.prisma",
    ],
    {
      env: { ...process.env, TENANT_DATABASE_URL: dsn },
      stdio: "inherit",
    },
  );
  if (res.status !== 0) {
    throw new Error(`prisma migrate deploy failed (exit ${res.status})`);
  }
}

async function applySetupSql(dsn: string): Promise<void> {
  const client = new Client({ connectionString: dsn });
  await client.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    for (const rel of TENANT_SETUP_FILES) {
      const sql = readFileSync(join(process.cwd(), rel), "utf8");
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

async function withAdvisoryLock<T>(
  dsn: string,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: dsn });
  await client.connect();
  try {
    const acquired = await client.query<{ pg_try_advisory_lock: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1))`,
      [key],
    );
    if (!acquired.rows[0]?.pg_try_advisory_lock) {
      throw new Error(`could not acquire advisory lock ${key}`);
    }
    try {
      return await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[tenant-migrate] fatal:", err);
  process.exit(1);
});
