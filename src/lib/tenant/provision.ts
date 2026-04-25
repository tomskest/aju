/**
 * Tenant database provisioning.
 *
 * `provisionTenant(orgId)` is called synchronously at org-create time from:
 *   - src/app/api/verify/route.ts        (personal org on signup)
 *   - src/app/api/orgs/route.ts          (explicit team org)
 *   - src/app/app/orgs/page.tsx          (team-org server action)
 *
 * Flow:
 *   1. Upsert `tenant` row with status='provisioning' (idempotent resume).
 *   2. Neon API: create role org_<cuid>_app with generated password.
 *   3. Neon API: create database org_<cuid> owned by that role.
 *   4. Connect as the new role; run setup SQL:
 *        CREATE EXTENSION vector, pg_trgm
 *        Prisma migrate deploy (via shell)
 *        vector-setup.sql, fts-setup/*.sql, rls-policies.sql
 *   5. Build direct + pooled DSNs, encrypt, write to tenant row.
 *   6. Set status='active', schema_version=CURRENT_TENANT_SCHEMA_VERSION,
 *      last_migrated_at=NOW().
 *   7. Create the org's default brain in the new tenant DB.
 *
 * Every step is idempotent. A partially-failed provision leaves the tenant
 * row in status='provisioning'; the next call resumes from the appropriate
 * step based on what already exists.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { prisma, CURRENT_TENANT_SCHEMA_VERSION } from "@/lib/db";
import { logger as baseLogger } from "@/lib/logger";
import { encryptDsn } from "./crypto";
import {
  buildDirectDsn,
  buildPooledDsn,
  createDatabase,
  createRole,
  deleteDatabase,
  deleteRole,
  getDefaultBranchId,
  getReadWriteEndpoint,
  NeonApiError,
  revealRolePassword,
} from "./neon-api";
import { provisionTenantStorage } from "@/lib/storage";

const log = baseLogger.child({ area: "tenant-provision" });

export { CURRENT_TENANT_SCHEMA_VERSION };

const TENANT_SETUP_FILES = [
  "data/tenant/vector-setup.sql",
  "data/tenant/fts-setup/migration.sql",
  "data/tenant/fts-setup/files-fts.sql",
  "data/tenant/rls-policies.sql",
];

function dbNameFor(orgId: string): string {
  if (!/^[a-z0-9]+$/.test(orgId)) {
    throw new Error(`invalid orgId for DB name: ${orgId}`);
  }
  return `org_${orgId}`;
}

function roleNameFor(orgId: string): string {
  return `${dbNameFor(orgId)}_app`;
}

export async function provisionTenant(orgId: string): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new Error(`organization ${orgId} does not exist`);

  const databaseName = dbNameFor(orgId);
  const roleName = roleNameFor(orgId);

  // Step 1: mark provisioning. Idempotent.
  await prisma.tenant.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      databaseName,
      dsnDirectEnc: "",
      dsnPooledEnc: "",
      status: "provisioning",
    },
    update: {},
  });

  // Step 2 + 3: Neon API create role + database.
  const branchId = await getDefaultBranchId();
  const endpoint = await getReadWriteEndpoint(branchId);

  await createRoleIdempotent(branchId, roleName);
  await createDatabaseIdempotent(branchId, databaseName, roleName);

  const password = await revealRolePassword({
    branchId,
    name: roleName,
  });

  const directDsn = buildDirectDsn({
    host: endpoint.host,
    role: roleName,
    password,
    database: databaseName,
  });
  const pooledDsn = buildPooledDsn({
    host: endpoint.host,
    role: roleName,
    password,
    database: databaseName,
  });

  // Step 4: install schema + setup SQL.
  await applyTenantSchema(directDsn);

  // Step 5+6: persist encrypted DSNs, mark active.
  await prisma.tenant.update({
    where: { organizationId: orgId },
    data: {
      dsnDirectEnc: encryptDsn(directDsn),
      dsnPooledEnc: encryptDsn(pooledDsn),
      status: "active",
      schemaVersion: CURRENT_TENANT_SCHEMA_VERSION,
      lastMigratedAt: new Date(),
    },
  });

  // Step 7: seed default brain. Done with a dedicated connection using the
  // direct DSN so we don't block on the LRU cache warming up.
  await seedDefaultBrain({ dsn: directDsn, org });

  // Step 8: per-tenant Tigris bucket + Editor-scoped access key. Skipped
  // when `TIGRIS_STORAGE_ACCESS_KEY_ID` is not set (local dev, or a
  // deployment that prefers operator-led provisioning) — the tenant is
  // still usable via the env-fallback path in tenant-storage.ts. A failure
  // here does not roll back the tenant DB; the next provisionTenant call
  // resumes at this step because every op inside is idempotent.
  if (process.env.TIGRIS_STORAGE_ACCESS_KEY_ID) {
    try {
      const result = await provisionTenantStorage(prisma, orgId);
      log.info(
        {
          organization_id: orgId,
          bucket: result.bucket,
          created: result.created,
        },
        "tenant storage provisioned",
      );
    } catch (err) {
      log.warn(
        { err, organization_id: orgId, step: "provision_tenant_storage" },
        "tenant storage provisioning failed — tenant usable via fallback until retry",
      );
      throw err;
    }
  } else {
    log.warn(
      { organization_id: orgId },
      "TIGRIS_STORAGE_ACCESS_KEY_ID not set — skipping tenant storage provisioning (runtime will use env fallback bucket)",
    );
  }
}

/**
 * Drop an org's tenant database and role. Used by org hard-delete paths.
 * Call `evictTenantClient(orgId)` BEFORE this so no cached PrismaClient
 * still holds open connections.
 */
export async function destroyTenant(orgId: string): Promise<void> {
  const databaseName = dbNameFor(orgId);
  const roleName = roleNameFor(orgId);
  const branchId = await getDefaultBranchId();

  try {
    await deleteDatabase({ branchId, name: databaseName });
  } catch (err) {
    if (!isNotFound(err)) {
      log.warn(
        {
          err,
          organization_id: orgId,
          database_name: databaseName,
          branch_id: branchId,
          step: "delete_database",
        },
        "neon provisioning step failed",
      );
      throw err;
    }
  }
  try {
    await deleteRole({ branchId, name: roleName });
  } catch (err) {
    if (!isNotFound(err)) {
      log.warn(
        {
          err,
          organization_id: orgId,
          role_name: roleName,
          branch_id: branchId,
          step: "delete_role",
        },
        "neon provisioning step failed",
      );
      throw err;
    }
  }
  try {
    await prisma.tenant.delete({ where: { organizationId: orgId } });
  } catch (err) {
    // P2025: row already gone — idempotent second call.
    if ((err as { code?: string } | null)?.code !== "P2025") throw err;
  }
}

// ---------- helpers ----------

async function createRoleIdempotent(
  branchId: string,
  name: string,
): Promise<void> {
  try {
    await createRole({ branchId, name });
  } catch (err) {
    if (isAlreadyExists(err)) return;
    log.warn(
      { err, role_name: name, branch_id: branchId, step: "create_role" },
      "neon provisioning step failed",
    );
    throw err;
  }
}

async function createDatabaseIdempotent(
  branchId: string,
  name: string,
  ownerRole: string,
): Promise<void> {
  try {
    await createDatabase({ branchId, name, ownerRole });
  } catch (err) {
    if (isAlreadyExists(err)) return;
    log.warn(
      {
        err,
        database_name: name,
        owner_role: ownerRole,
        branch_id: branchId,
        step: "create_database",
      },
      "neon provisioning step failed",
    );
    throw err;
  }
}

function isAlreadyExists(err: unknown): boolean {
  if (!(err instanceof NeonApiError)) return false;
  if (err.status === 409) return true;
  const msg = err.message.toLowerCase();
  return msg.includes("already exists") || msg.includes("duplicate");
}

function isNotFound(err: unknown): boolean {
  return err instanceof NeonApiError && err.status === 404;
}

async function applyTenantSchema(directDsn: string): Promise<void> {
  // Fresh tenant DB — run `prisma migrate deploy`, which will apply every
  // migration in data/tenant/migrations/ from the init baseline forward.
  // Existing tenants provisioned before migrations were introduced must be
  // baselined once via `prisma migrate resolve --applied 20260422000000_init`
  // before this script runs against them (see doc/prisma-migrations.md).
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
      env: { ...process.env, TENANT_DATABASE_URL: directDsn },
      stdio: "inherit",
    },
  );
  if (res.status !== 0) {
    log.warn(
      { exit_status: res.status, step: "apply_tenant_schema" },
      "neon provisioning step failed",
    );
    throw new Error(
      `prisma migrate deploy failed for tenant DB (exit ${res.status})`,
    );
  }

  // Apply raw-SQL setup (extensions, triggers, indexes, RLS).
  const client = new Client({ connectionString: directDsn });
  await client.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    for (const rel of TENANT_SETUP_FILES) {
      const sql = readFileSync(join(process.cwd(), rel), "utf8");
      await client.query(sql);
    }
  } catch (err) {
    log.warn(
      { err, step: "apply_tenant_schema_sql" },
      "neon provisioning step failed",
    );
    throw err;
  } finally {
    await client.end();
  }
}

async function seedDefaultBrain(params: {
  dsn: string;
  org: { id: string; name: string; ownerUserId: string; isPersonal: boolean };
}): Promise<void> {
  const client = new Client({ connectionString: params.dsn });
  await client.connect();
  try {
    // Idempotent: skip entirely if a brain already exists in this tenant.
    // Re-runs of provisionTenant (resume after partial failure) hit this
    // branch and don't create duplicates.
    const existing = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "brains"`,
    );
    if (Number(existing.rows[0]?.count ?? "0") > 0) return;

    const brainId = cuidlike();
    const brainAccessId = cuidlike();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "brains" (id, name, type, created_at) VALUES ($1, $2, $3, NOW())`,
      [
        brainId,
        params.org.isPersonal ? "Personal" : params.org.name,
        params.org.isPersonal ? "personal" : "org",
      ],
    );
    await client.query(
      `INSERT INTO "brain_access" (id, brain_id, user_id, agent_id, role, created_at)
       VALUES ($1, $2, $3, NULL, 'owner', NOW())`,
      [brainAccessId, brainId, params.org.ownerUserId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

function cuidlike(): string {
  // Not a real cuid — a placeholder id generator that matches the
  // ^[a-z0-9]+$ shape the RLS session-var validator expects.
  return (
    "c" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}
