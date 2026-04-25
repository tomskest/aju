---
title: Tenant isolation
description: One database per organization, plus brain-id RLS inside each tenant DB.
order: 60
---

# Tenant isolation

aju enforces tenant boundaries at two layers:

1. **The database boundary.** Every organization gets its own Postgres
   database (`org_<cuid>`) inside a shared Neon project (`aju.sh`,
   project id `shiny-union-36888903`, region `aws-eu-central-1`). Cross-org
   data is never visible in one query — a connection string only grants
   access to that one org's DB.
2. **Brain-id RLS inside each tenant DB.** Policies live in
   `prisma/tenant/rls-policies.sql` and gate on `brain_id` via the session
   variable `app.current_brain_ids`, set per-request via `SET LOCAL` inside
   a transaction.

The DB boundary handles cross-org isolation. RLS is defense in depth inside
one org — it catches the "we forgot a `brainId` filter" class of bug within
a tenant that contains multiple brains.

## The organization model

`Organization` (`prisma/control/schema.prisma`) lives in the control DB and
is the tenant. Every user gets a personal org on signup (`isPersonal=true`).
Shared orgs are created by owners and joined via `Invitation`,
`AccessRequest`, or domain auto-admit.

Every org that has a `status='active'` row in the `Tenant` table has a
matching per-tenant Postgres database. Tenant tables carry no
`organization_id` column because there is no need — the database itself
IS the org.

## Tenant routing: `Tenant` table + `tenantDbFor`

`src/lib/db.ts` exposes `tenantDbFor(orgId)` — every tenant-touching route
calls this (usually through `withTenant`) to get a `PrismaClient-tenant`
pointed at the right database.

```ts
export async function tenantDbFor(orgId: string): Promise<PrismaClientTenant> {
  return tenantCache.get(orgId);
}
```

Under the hood:

1. LRU cache hit → return the cached client (default cap 30, configurable
   via `TENANT_CLIENT_CACHE_MAX`).
2. Miss → load `tenant` row from the control DB, check
   `status`, `schemaVersion`, decrypt the pooled DSN with
   `TENANT_DSN_ENC_KEY`, instantiate a fresh `PrismaClient-tenant`.
3. Evict LRU-oldest if the cache is full. Disconnect clients idle for 10+
   minutes via a background reaper.

A tenant row with `status='suspended' | 'archived' | 'provisioning'` throws
a specific error class (`TenantSuspendedError`, etc.). A tenant whose
recorded `schemaVersion` is behind the code-side
`CURRENT_TENANT_SCHEMA_VERSION` throws `TenantSchemaDriftError` until the
migration runs.

## Provisioning: `src/lib/tenant-provision.ts`

`provisionTenant(orgId)` runs synchronously after `Organization.create`
commits. It:

1. Upserts a `tenant` row with `status='provisioning'`. Idempotent resume.
2. Creates Neon role `org_<cuid>_app` via the Neon HTTP API.
3. Creates database `org_<cuid>` owned by that role.
4. Applies the tenant Prisma schema + `CREATE EXTENSION vector, pg_trgm` +
   the FTS + RLS SQL files.
5. Encrypts direct + pooled DSNs with AES-GCM and writes them to the tenant
   row (`dsnDirectEnc`, `dsnPooledEnc`).
6. Flips `status='active'`, stamps `schema_version` and `last_migrated_at`.
7. Seeds a default brain + owner `BrainAccess` row.

Every step is idempotent. A partially-failed provision leaves the tenant in
`status='provisioning'`; `scripts/retry-provision.ts` re-runs
`provisionTenant` and each step no-ops if its side effect already exists.

## Teardown: `destroyTenant` and `deleteOrganizationWithStorage`

`destroyTenant(orgId)` drops the Neon database + role and deletes the
tenant row. Idempotent — 404 from Neon (DB already gone) and P2025 from
Prisma (tenant row already gone) are both treated as success.

`deleteOrganizationWithStorage(orgId)` in `src/lib/brain-delete.ts` is the
high-level org delete flow used by `/api/me/delete` and the org settings
delete action:

1. Enumerate every brain's `VaultFile.s3Key` in the tenant DB, batch-delete
   from R2 (1000 keys per `DeleteObjectsCommand`). Best-effort — if the
   tenant DB is already gone from a prior attempt, the S3 wipe is skipped
   with a warning.
2. `evictTenantClient(orgId)` so no cached `PrismaClient` holds open
   connections.
3. `destroyTenant(orgId)` drops DB + role + tenant row.
4. Delete the `Organization` row in the control DB; cascades take care of
   memberships, invitations, domains, access requests, API keys pinned to
   this org.

Safe to retry at any point.

## RLS inside the tenant DB

Applied by `provisionTenant` (on create) and `scripts/tenant-migrate.ts`
(on every deploy). Enables + forces RLS on:

```
brains, brain_access, vault_documents, vault_files,
document_links, vault_change_log
```

`agent` has no `brain_id` column; any row in the tenant DB belongs to this
org by construction, so no RLS policy is applied.

### The policy shape

Every tenant-scoped table with a `brain_id` column gets the same policy:

```sql
CREATE POLICY brain_isolation ON "<table>"
  USING (
    current_setting('app.current_brain_ids', true) IS NULL
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  )
  WITH CHECK (<same predicate>);
```

`brains` itself uses the same shape but compares `id` instead of `brain_id`:

```sql
USING (
  current_setting('app.current_brain_ids', true) IS NULL
  OR id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
)
```

### Why the NULL escape hatch

The `IS NULL` branch keeps three things working:

1. Provisioning writes (seed brain + `BrainAccess`) that run before any
   `BrainAccess` row exists to read from.
2. Per-tenant maintenance jobs (cron backfills, migrations) that iterate
   every tenant DB and need unscoped access.
3. The `current_setting(..., true)` call returns `NULL` when the variable
   has never been set — "unset var = no isolation" is the correct safe
   default for maintenance paths.

**HTTP request paths MUST go through `withBrainContext` / `withTenant`.**
Those helpers always set the variable — even for a user with no brain
access, they set it to the sentinel `'__none__'` so the "unset escape"
does not fire.

### CHECK constraint: `brain_access` actor XOR

`prisma/tenant/rls-policies.sql` also installs a check constraint:

```sql
ALTER TABLE brain_access
  ADD CONSTRAINT brain_access_actor_xor
  CHECK ((user_id IS NULL) <> (agent_id IS NULL));
```

Exactly one of `user_id` / `agent_id` must be set — Prisma can't express the
XOR, so it lives in raw SQL.

## Setting the session variable

`src/lib/tenant-context.ts` is the only sanctioned way to pin a request to
a brain set:

```ts
export async function withBrainContext<T>(
  client: PrismaClientTenant,
  brainIds: readonly string[],
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const joined = formatBrainIds(brainIds);
  return client.$transaction(async (tx) => {
    await setBrainContextOnTx(tx, brainIds);
    if (joined.length === 0) {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_brain_ids = '__none__'`);
    }
    return fn(tx);
  });
}
```

Key points:

- `SET LOCAL` scopes the variable to the transaction. Prisma uses a
  connection pool — a plain `SET` would leak state onto the next request
  on the same connection.
- Brain ids are regex-validated against `^[a-z0-9]+$` before interpolation
  (cuids already conform). Prevents injection via `$executeRawUnsafe`,
  which is required because `SET LOCAL` doesn't accept parameter
  placeholders.
- Empty `brainIds` stamps the sentinel `'__none__'`, producing zero rows
  rather than triggering the "unset = no isolation" branch.

## `withTenant` — the canonical request scope

`withTenant` in `src/lib/tenant-context.ts` is the high-level entry point
for API routes:

```ts
return withTenant(
  { organizationId, userId: auth.userId },
  async ({ tenant, tx, brainIds }) => {
    // tx is a tenant-DB transaction, app.current_brain_ids is set
    ...
  },
);
```

It:

1. Resolves the tenant client via `tenantDbFor(organizationId)`.
2. Loads the caller's accessible brain ids from `BrainAccess` in that DB.
3. Opens a transaction and sets `app.current_brain_ids` = the joined list.
4. Hands control to `fn({ tenant, tx, brainIds })`.

For maintenance paths that need unscoped access inside one tenant DB (org
setup, seed inserts before `BrainAccess` exists), pass `unscoped: true`.
That skips the brain-id lookup and the `SET LOCAL`, leaving the DB
boundary as the only guard.

## What the app layer still enforces

RLS is a backstop. The app layer enforces:

- Which org (= which tenant DB) the request uses (`auth.organizationId`
  from the pinned API key, or `user.personalOrgId`).
- Which brain the request touches (`resolveBrain`, `src/lib/brain.ts`).
- Whether the caller has write access (`canWrite`).
- Which documents are returned by a search or list query (brainId filter,
  membership filter).

The DB boundary handles cross-org. RLS catches the "we forgot an `AND`
clause" class of bugs within one org. Neither replaces permission logic.

## What RLS does NOT cover

- `user`, `session`, `account`, `verification`, `organization`,
  `organization_membership`, `invitation`, `organization_domain`,
  `access_request`, `api_key`, `device_code`, `tenant`, `waitlist_entry`
  — all control-plane tables. The control DB is a shared tenant by design;
  isolation between users there is enforced by query filters
  (e.g. `where: { userId: ... }`), not RLS.
- `agent` in the tenant DB — no `brain_id` column. Every agent row belongs
  to this org by virtue of being in this database.
