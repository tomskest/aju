# Neon migration: DB-per-org with in-DB RLS

Plan for moving aju's data layer from a single shared Postgres on Railway to
Neon, where each organization gets its own Postgres database. Row-Level Security
stays in place inside each tenant DB so multi-brain search and brain-scoped
access grants keep working unchanged.

Current status: **Phases 1–3 landed on branch** (code). Phase 0 Neon DDL
(CREATE DATABASE aju_control) and env-var setup are blocked on explicit user
approval. Cutover has not run. The whole-repo typecheck and `next build`
pass against the split schemas.

## Constraints we're designing around

- **Data loss is acceptable during cutover.** Pre-launch, no production data to
  preserve. We can wipe tenant tables and recreate them empty per org.
- **Multi-brain search must keep working.** Brains inside one org share a DB;
  we do not split brains into separate schemas or databases.
- **Direct DB access is a feature we want to expose.** Enterprise customers
  should be able to request a read-only Postgres connection string for their
  own data.
- **Operational simplicity matters more than theoretical purity.** We use one
  Neon project with many databases, not a project per org, until a specific
  customer needs physical isolation.

## Target architecture

```
┌─ Neon project "aju" ─────────────────────────────────┐
│  default branch "main"                               │
│  one compute endpoint (autoscales), shared           │
│  pooled endpoint (PgBouncer, txn mode) for runtime   │
│  direct endpoint for migrations / DDL                │
│                                                      │
│  database: aju_control                               │
│    user, session, account, verification              │
│    organization, organization_membership             │
│    invitation, organization_domain, access_request   │
│    api_key, oauth_client, oauth_authorization_code   │
│    device_code, waitlist_entry                       │
│    tenant  ← NEW: org_id → per-tenant DB name + DSNs │
│                                                      │
│  database: org_<cuid-a>                              │
│    brain, brain_access                               │
│    agent                                             │
│    vault_document, document_link                     │
│    vault_change_log, vault_file                      │
│    RLS policies on brain_id                          │
│                                                      │
│  database: org_<cuid-b>                              │
│  database: org_<cuid-c>                              │
│  …                                                   │
└──────────────────────────────────────────────────────┘
```

### Control plane vs tenant split

| Model                    | Lives in        | Why                                               |
|--------------------------|-----------------|---------------------------------------------------|
| User                     | control         | a single user can belong to multiple orgs         |
| Session                  | control         | auth is global                                    |
| Account                  | control         | OAuth/provider accounts are user-scoped           |
| Verification             | control         | magic-link tokens, global                         |
| Organization             | control         | org metadata + billing                            |
| OrganizationMembership   | control         | user↔org grants, cross-tenant                     |
| Invitation               | control         | invite-by-email flow is pre-membership            |
| OrganizationDomain       | control         | verified domains for auto-join                    |
| AccessRequest            | control         | pending join requests                             |
| ApiKey                   | control         | keys belong to users; org_id denormalized for routing |
| OAuthClient / OAuthAuthorizationCode | control | auth infrastructure, not tenant data     |
| DeviceCode               | control         | device-flow state, pre-key                        |
| WaitlistEntry            | control         | pre-signup, no org yet                            |
| **Tenant** (new)         | control         | maps `organization_id` → tenant DB name + DSNs    |
| Brain                    | tenant          | container, scoped to one org                      |
| BrainAccess              | tenant          | per-brain grants (userId/agentId denormalized)    |
| Agent                    | tenant          | org-owned runtime actor (createdByUserId denormalized) |
| VaultDocument            | tenant          | note content                                      |
| DocumentLink             | tenant          | wikilink edges                                    |
| VaultChangeLog           | tenant          | audit log                                         |
| VaultFile                | tenant          | file metadata (S3 content stays in shared bucket) |

### The new `Tenant` model (control plane)

```prisma
model Tenant {
  id                String   @id @default(cuid())
  organizationId    String   @unique @map("organization_id")
  databaseName      String   @map("database_name")        // e.g. "org_cmxyz123"
  region            String   @default("aws-eu-central-1")

  // Two DSNs, both AES-GCM encrypted at rest. Migrations and DDL need the
  // direct endpoint (prepared statements, session state). Runtime uses the
  // pooled endpoint (PgBouncer, transaction mode) with `pgbouncer=true`.
  dsnDirectEnc      String   @map("dsn_direct_enc")
  dsnPooledEnc      String   @map("dsn_pooled_enc")

  // Bumped by scripts/tenant-migrate.ts after a successful `prisma migrate
  // deploy`. Compared against a code-side constant at request time; drift
  // flips the tenant into read-only mode with a user-facing banner.
  schemaVersion     Int      @default(0) @map("schema_version")

  status            String   @default("provisioning")     // provisioning | active | suspended | archived
  createdAt         DateTime @default(now()) @map("created_at")
  lastMigratedAt    DateTime? @map("last_migrated_at")

  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@map("tenant")
}
```

DSNs are encrypted at rest using a symmetric key from env
(`TENANT_DSN_ENC_KEY`, 32 bytes base64). Never logged. The encryption format is
`v1:<iv-b64>:<ciphertext-b64>:<tag-b64>` so we can prepend a version byte on
rotation (see "Risks and mitigations").

## Phase plan

Total: ~10–14 days of focused work.

### Phase 0 — decisions & prep (0.5 day)

- Pick Neon plan. Free for phase 1 prototyping; Launch or Scale before cutover.
- Create Neon project `aju` in `aws-eu-central-1`.
- Create `aju_control` database in the default branch.
- Capture from the Neon console:
  - `NEON_API_KEY` (project-scoped, admin) — used by the provisioning code path
    and `scripts/tenant-migrate.ts`.
  - `NEON_PROJECT_ID`.
  - `DATABASE_URL` → direct DSN for `aju_control` (used by Prisma CLI).
  - `CONTROL_POOLED_URL` → pooled DSN for `aju_control` (used at runtime with
    `?pgbouncer=true`).
- Generate `TENANT_DSN_ENC_KEY` via `openssl rand -base64 32`. Store in Railway.
- Document env vars in `.env.example`: `NEON_API_KEY`, `NEON_PROJECT_ID`,
  `DATABASE_URL`, `CONTROL_POOLED_URL`, `TENANT_DSN_ENC_KEY`,
  `USE_LOCAL_TENANT_DB`.

### Phase 1 — Prisma schema split (2–3 days)

Create two Prisma schemas with separate generator outputs and migration dirs:

```
prisma/
  control/
    schema.prisma           → generator output: node_modules/@prisma/client
    migrations/
  tenant/
    schema.prisma           → generator output: node_modules/@prisma/client-tenant
    migrations/
  rls-policies.sql          → MOVED under tenant/; see Phase 1.5
  vector-setup.sql          → MOVED under tenant/
  fts-setup/                → MOVED under tenant/
```

- `prisma/control/schema.prisma`: everything listed above under "control", plus
  the new `Tenant` model. Keep the current `@prisma/client` generator output
  path so existing imports keep working during the transition.
- `prisma/tenant/schema.prisma`: the 7 tenant models (Brain, BrainAccess,
  Agent, VaultDocument, DocumentLink, VaultChangeLog, VaultFile).

Regenerate:

```bash
npx prisma generate --schema prisma/control/schema.prisma
npx prisma generate --schema prisma/tenant/schema.prisma
```

Update `package.json` scripts:

```json
"postinstall": "prisma generate --schema prisma/control/schema.prisma && prisma generate --schema prisma/tenant/schema.prisma",
"build": "npm run postinstall && next build",
"db:migrate:control": "prisma migrate dev --schema prisma/control/schema.prisma",
"db:migrate:tenant": "tsx scripts/tenant-migrate.ts",
```

New `src/lib/db.ts` shape:

```ts
// existing singleton, now backed by the control Prisma client
export const prisma: PrismaClientControl;

// new — returns (and caches) a Prisma client pointed at an org's DB
export async function tenantDbFor(orgId: string): Promise<PrismaClientTenant>;
```

`tenantDbFor` internals:
- LRU cache, default cap 30 (tunable via `TENANT_CLIENT_CACHE_MAX`; see
  "Risks" for sizing notes — each Prisma client holds ~30-50 MB plus its pool).
- On miss: read `tenant` row, decrypt pooled DSN, instantiate
  `new PrismaClientTenant({ datasourceUrl })` with `connection_limit=1`
  (PgBouncer owns the pool), cache.
- On evict: `await client.$disconnect()`.
- 10-minute idle reaper closes unused clients.
- Concurrent cache misses for the same org collapse into one load via a
  per-key in-flight promise map.

**Alternative worth benchmarking before Phase 3:** use `@neondatabase/serverless`
+ `@prisma/adapter-neon` to create ephemeral per-request Prisma clients over
Neon's HTTP/WebSocket proxy. Removes the LRU entirely, sidesteps the
30-clients-on-Railway RAM ceiling, and matches Vercel/Next's serverless model.
Cost: +1 fetch round-trip per query versus pooled TCP. Decide in Phase 1 so
Phase 3 code targets the winner.

Dev-mode escape hatch: `USE_LOCAL_TENANT_DB=1` → `tenantDbFor` returns a single
shared `PrismaClientTenant` pointed at `DATABASE_URL`. Local dev stays one-DB.
In this mode, `tenant` rows are ignored entirely; the tenant schema is applied
to the control DB alongside the control schema.

No call sites rewritten in this phase. The control client keeps handling
everything the way it does today. This phase is scaffolding only.

### Phase 1.5 — schema surgery for cross-DB boundaries (1 day)

This is the step the previous plan skipped. When tenant tables move to their
own DB, every foreign key pointing from a tenant table to a control table
becomes impossible — Postgres FKs cannot cross databases.

Denormalize these columns in `prisma/tenant/schema.prisma`:

| Tenant table        | Current FK                               | After split                                  |
|---------------------|------------------------------------------|----------------------------------------------|
| `brain_access`      | `user_id → user.id`                      | plain `String?` (app-layer integrity)        |
| `brain_access`      | `agent_id → agent.id`                    | stays FK (both in tenant)                    |
| `agent`             | `organization_id → organization.id`      | **drop column entirely** (DB = org boundary) |
| `agent`             | `created_by_user_id → user.id`           | plain `String` (app-layer integrity)         |
| `vault_documents`   | `organization_id → organization.id`      | drop column entirely                         |
| `vault_files`       | `organization_id → organization.id`      | drop column entirely                         |
| `vault_files`       | `uploaded_by → user.id` (string today)   | stays plain `String?`                        |
| `document_links`    | `organization_id → organization.id`      | drop column entirely                         |
| `vault_change_log`  | `organization_id → organization.id`      | drop column entirely                         |
| `vault_change_log`  | `changed_by / actor_id → user/agent`     | plain `String?` (already is)                 |
| `brains`            | `organization_id → organization.id`      | drop column entirely                         |

Kept FKs (all intra-tenant): `brain_access.brain_id → brains.id`,
`vault_documents.brain_id → brains.id`, etc. These continue to work.

Integrity for denormalized user references is enforced at the app layer in
two places:
1. When an `OrganizationMembership` is deleted (user leaves org), a
   control-side hook nulls out the user's rows in the tenant DB:
   `brain_access.user_id`, `agent.created_by_user_id` (either null it or
   reassign to a "deleted user" sentinel), `vault_files.uploaded_by`.
2. When a `User` is hard-deleted (`/api/me/delete`), iterate the user's
   memberships and run the same cleanup per tenant DB before deleting the
   user row in control.

### Phase 1.6 — RLS rewrite (0.5 day)

Current RLS gates tenant tables on `app.current_organization_id`. Post-split
the DB itself is the org boundary, so org-level RLS is redundant. We replace
it with brain-level RLS: defense-in-depth against a code bug letting one brain's
data leak into another user's query within the same org.

New session variable: `app.current_brain_ids` — a comma-separated list of
brain cuids the current request is allowed to see. Set via `SET LOCAL` inside
a transaction.

Rewrite `prisma/tenant/rls-policies.sql` (the port of the current file):

```sql
-- For each tenant table with a brain_id column
ALTER TABLE "brains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brains" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brain_isolation ON "brains";
CREATE POLICY brain_isolation ON "brains"
  USING (
    current_setting('app.current_brain_ids', true) IS NULL
    OR id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  )
  WITH CHECK (
    current_setting('app.current_brain_ids', true) IS NULL
    OR id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  );

-- For tables that reference brain_id directly (vault_documents, vault_files,
-- document_links, vault_change_log, brain_access): same shape with
-- `brain_id = ANY(...)` instead of `id = ANY(...)`.
```

`agent` has no `brain_id`; it gets no RLS policy (any row in the tenant DB
belongs to this org by construction).

Rewrite `src/lib/tenant-context.ts`:

```ts
export async function withBrainContext<T>(
  tenantClient: PrismaClientTenant,
  brainIds: readonly string[],
  fn: (tx: TenantTransactionClient) => Promise<T>,
): Promise<T>;
```

Validates every brain id against `^[a-z0-9]+$` (cuid shape), joins with `,`,
and calls `SET LOCAL app.current_brain_ids = '<list>'` inside the transaction.
The current `withOrgContext` / `setOrgContextOnTx` helpers are deleted — their
org-scoping responsibility moved to the DB boundary.

### Phase 2 — provisioning service (2 days)

`src/lib/tenant-provision.ts`:

```ts
async function provisionTenant(orgId: string): Promise<Tenant> {
  // 1. Write tenant row with status='provisioning'. Idempotent upsert —
  //    if a row exists with status='provisioning', resume from where we left
  //    off rather than failing.
  // 2. Via Neon HTTP API (POST /projects/{id}/branches/{branch}/databases):
  //    create database org_<cuid>.
  // 3. Via Neon HTTP API (POST /projects/{id}/branches/{branch}/roles):
  //    create role org_<cuid>_app with a random 32-byte password.
  // 4. Connect to the new DB as the management role; run as one transaction:
  //      GRANT ALL ON DATABASE org_<cuid> TO org_<cuid>_app;
  //      REVOKE CONNECT ON DATABASE org_<cuid> FROM PUBLIC;
  //      CREATE EXTENSION IF NOT EXISTS vector;
  //      CREATE EXTENSION IF NOT EXISTS pg_trgm;
  // 5. Apply tenant schema. Either:
  //      (a) spawn `prisma migrate deploy --schema prisma/tenant/schema.prisma`
  //          with env { DATABASE_URL: directDsn }, or
  //      (b) use the programmatic migrate API if it lands in Prisma v6.
  //    Phase 2 picks (a); swap later if (b) matures.
  // 6. Apply setup SQL in this order:
  //      prisma/tenant/vector-setup.sql        (embedding columns + HNSW)
  //      prisma/tenant/fts-setup/migration.sql (docs tsvector + trigram)
  //      prisma/tenant/fts-setup/files-fts.sql (files tsvector + trigram)
  //      prisma/tenant/rls-policies.sql        (brain-id RLS, Phase 1.6)
  // 7. Build both DSNs (direct + pooled) from the Neon endpoint info,
  //    encrypt, write to tenant row, set schema_version to current code
  //    constant, status='active', last_migrated_at=NOW().
  // 8. Create the org's default personal brain in the new tenant DB.
}
```

Idempotent end-to-end — safe to retry if any step fails. A failed provisioning
leaves the tenant row in `status='provisioning'` and the next retry resumes.

**Provisioning trigger.** Single source of truth: `provisionTenant(orgId)` is
called synchronously inside every org-creation path. No boot-time sweep in
normal operation. The call sites that need wiring:

- `src/app/api/verify/route.ts` — the `Organization.create` for personal orgs
  in the signup/verify flow (around line 177).
- `src/app/api/orgs/route.ts` — the `Organization.create` for explicit team
  orgs (around line 102).
- `src/app/app/orgs/page.tsx` — the `Organization.create` in the team-org
  server action (around line 40).

If provisioning fails mid-flow, the org row is kept in status='provisioning'
and a retry endpoint (`POST /api/orgs/[id]/provision`) lets an admin reattempt.
Users whose org is provisioning see a waiting page.

**One-time backfill** (cutover only, not part of steady state):
`scripts/provision-existing-orgs.ts` iterates `organization` rows that have no
`tenant` row and provisions them. Acquires a Postgres advisory lock
(`pg_try_advisory_lock(hashtext('tenant-provision-sweep'))`) so multiple
replicas don't race.

**`scripts/tenant-migrate.ts`** — applies schema changes to every active
tenant. Iterates `tenant` rows with `status='active'`, for each one:
1. Acquires advisory lock on `hashtext('tenant-migrate:' || database_name)`.
2. Shells out to `prisma migrate deploy --schema prisma/tenant/schema.prisma`
   with `DATABASE_URL=<directDsn>`.
3. Re-applies `vector-setup.sql`, `fts-setup/*.sql`, `rls-policies.sql` (all
   idempotent).
4. Updates `tenant.schema_version` and `last_migrated_at`.
5. On failure, leaves `schema_version` untouched and records error in logs.

Runs in CI after every deploy that changes `prisma/tenant/`.

### Phase 3 — route requests to tenant clients (3–4 days)

Replace direct `prisma.*` calls on tenant tables with the tenant client.

`src/lib/tenant-context.ts`:

```ts
export async function withTenant<T>(
  req: NextRequest,
  fn: (ctx: {
    control: PrismaClientControl;
    tenant: PrismaClientTenant;
    tx: TenantTransactionClient;    // SET LOCAL-scoped; use for tenant reads/writes
    user: User;
    organizationId: string;
    brainIds: readonly string[];    // brains this request may access
  }) => Promise<T>,
): Promise<T>
```

`withTenant` internals:
1. Resolve the user and orgId from the request (cookies or API key).
2. `control = prisma`.
3. `tenant = await tenantDbFor(orgId)`.
4. If `tenant.schemaVersion < CODE_SCHEMA_VERSION`: return `503` with a
   `Retry-After` header. If it's a GET, fall through to read-only mode and
   set a response header `X-Aju-Tenant-Drifted: 1` that the UI reads to show
   a banner.
5. Compute `brainIds`: query `brain_access` in the tenant DB filtered by
   the current user/agent id (single indexed lookup). Include brains the user
   owns (via `brain_access.role='owner'`).
6. Open a transaction on the tenant client, `SET LOCAL app.current_brain_ids`,
   and hand the tx to `fn`.

Example:

```ts
export async function GET(req: NextRequest) {
  return withTenant(req, async ({ tx }) => {
    const docs = await tx.vaultDocument.findMany({
      where: { section: "06-Sales" },
    });
    return NextResponse.json(docs);
  });
}
```

**Call-site scope.** 38 files reference the tenant-table model accessors today
(grep `prisma\.(brain|vaultDocument|vaultFile|vaultChangeLog|documentLink|agent|brainAccess)`).
The full list:

- `src/lib/*`: `brain.ts`, `brain-delete.ts`, `mcp/tools.ts`, `rebuild-links.ts`,
  `update-embedding.ts`, `reindex.ts`.
- `src/app/api/brains/**`, `src/app/api/vault/**`, `src/app/api/agents/**`,
  `src/app/api/mcp/**`, `src/app/api/orgs/[id]/route.ts`,
  `src/app/api/me/delete/route.ts`, `src/app/api/me/export/route.ts`,
  `src/app/api/usage/route.ts`, `src/app/api/cron/backfill-embeddings/route.ts`.
- `src/app/app/**` pages that do server-side reads (brains, agents, usage, org
  settings).
- `mcp/aju-server.ts` — the standalone MCP server entrypoint.

Straightforward mechanical edit — TypeScript will surface every place that
still calls a tenant-table accessor on the control client (those accessors no
longer exist on `PrismaClientControl` after the split).

**Scripts also need updating:**
- `scripts/backfill-embeddings.ts` — wrap in a loop over active tenants.
- Delete `scripts/backfill-organizations.ts` (obsolete post-split).

**Error handling:**
- tenant row missing → impossible post-phase-2; fail loud with 500.
- tenant DB unreachable → retry once with backoff, then 503.
- `schema_version < code_version` → read-only mode, user-facing banner.
- tenant `status='suspended'` → 402 (billing lapsed).

### Cutover (0.5 day)

1. Merge and deploy code that uses `tenantDbFor()` and the split schemas.
2. Run the one-time backfill: `npx tsx scripts/provision-existing-orgs.ts`.
   This sweeps every `organization` without a `tenant` row, calls
   `provisionTenant`, and is serialized via advisory lock.
3. Existing tenant-table data in the old shared DB is now orphaned.
4. Drop the orphaned tables (separate migration in `prisma/control/migrations`):
   ```sql
   DROP TABLE brain_access, brain, agent, vault_documents, document_links,
              vault_change_log, vault_files CASCADE;
   ```
5. **S3 cleanup.** Every object under `vault-files/*` in the S3 bucket is now
   orphaned (VaultFile rows wiped). Pre-launch we accept the orphans; a
   separate `scripts/purge-orphan-s3.ts` can sweep later. If pre-launch data
   is sensitive, run the purge before step 4.
6. Users log in as usual — same credentials, same orgs — into empty brains
   and start over.

That's it. No dual-write, no backfill, no gradual rollout. The whole point of
"data loss is acceptable" is that we can flip the switch.

## Features this unlocks (phase 4+)

### Data export per org

```ts
async function exportOrg(orgId: string): Promise<Readable> {
  const tenant = await prisma.tenant.findUnique({ where: { organizationId: orgId } });
  const dsn = decrypt(tenant.dsnDirectEnc);
  // Streams pg_dump stdout — for large orgs, pipe to S3 presigned upload rather
  // than buffering.
  return spawn("pg_dump", ["--format=custom", dsn]).stdout;
}
```

Wire to a "Download my data" button in `/app/orgs/[id]/settings`. One-click
GDPR data portability.

### Hard delete per org

```ts
// 1. Close any cached client for this org
await tenantClientCache.evict(orgId);

// 2. Via Neon API: DELETE /projects/{id}/branches/{branch}/databases/org_<cuid>
// 3. Via Neon API: DELETE role org_<cuid>_app, org_<cuid>_external
// 4. DELETE FROM tenant WHERE organization_id = $1
// 5. DELETE FROM organization WHERE id = $1
```

Complete, atomic destruction of all of an org's notes, files metadata, graph
edges, audit log. (S3 files cleaned up separately via a background job keyed
on the orgId prefix in the bucket.)

### Direct DB access (enterprise tier)

For customers who want raw SQL against their own data, issue a second role
with `BYPASSRLS`. Because the DB itself is the org boundary, "bypass RLS"
simply means "see all rows in your own DB" — which is exactly what the
customer should see.

```sql
-- inside the org's DB, as the management role
CREATE ROLE org_<cuid>_external LOGIN PASSWORD '<random>' BYPASSRLS;
GRANT CONNECT ON DATABASE org_<cuid> TO org_<cuid>_external;
GRANT USAGE ON SCHEMA public TO org_<cuid>_external;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO org_<cuid>_external;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO org_<cuid>_external;
```

Surface the resulting DSN in `/app/orgs/[id]/settings/database`, gated behind
plan. Rotate with `ALTER ROLE ... PASSWORD`, revoke with `DROP ROLE`. The
customer sees only their own DB because their role has `CONNECT` privilege on
only that DB and cannot see other DBs in the same Neon project via `\l` either.

### Regional residency

When a customer needs EU-only data storage, either:
- Provision in `aws-eu-central-1` at org-create time (default already), or
- Move them to a dedicated EU-only Neon project if they need full project
  isolation in addition to regional placement. `tenant.region` stays, but a
  future `tenant.projectId` column lets us point specific orgs at a different
  Neon project without code changes elsewhere.

## What we deliberately gave up

- **Per-org scale-to-zero.** All tenant DBs share the project's compute, so
  the compute only sleeps when *every* tenant is idle. Acceptable at early
  scale; upgrade path is to move specific orgs into their own projects when
  they need it.
- **Noisy-neighbor protection.** A tenant running a huge vector search
  consumes compute the others share. Neon autoscales the compute, so this
  is a degraded-not-broken scenario.
- **Cross-tenant analytics in SQL.** Queries like "total documents across
  all orgs" now need app-level fan-out or a nightly summary job writing to
  a `tenant_stats` table in control.
- **Single point-in-time restore.** Neon PITR is per-branch, not per-database
  (see risks).

## Risks and mitigations

| Risk                                               | Mitigation                                                           |
|----------------------------------------------------|----------------------------------------------------------------------|
| Migration drift (code expects schema N, tenant on N-1) | Per-tenant `schema_version`; block writes / degrade to read-only if drifted; alert on drift > 1h |
| LRU cache thrashing at high org count              | Default cap 30 (tunable); metric on miss rate; consider `@neondatabase/serverless` adapter |
| RAM ceiling from cached Prisma clients             | Each client ≈ 30-50 MB; 30 clients ≈ 1-1.5 GB; monitor RSS, scale Railway instance class accordingly |
| PgBouncer transaction mode + Prisma prepared statements | Append `?pgbouncer=true&connection_limit=1` to pooled DSN; prepared statements auto-disabled |
| `CREATE DATABASE` rate limits on Neon              | Use Neon HTTP API (not raw SQL), which has documented quotas; back off on 429 |
| Connection explosion                               | Pooled DSN at runtime; direct only for migration paths               |
| Key rotation for `TENANT_DSN_ENC_KEY`              | Versioned ciphertext (`v1:...`); support primary + secondary key in env; re-encrypt on next write; audit row count with old version |
| Restore-single-tenant in disaster                  | Neon PITR is per-branch — all tenant DBs revert together. Per-tenant recovery uses scheduled `pg_dump` to S3 (daily) + point-in-time replay from audit log for critical writes. Document runbook. |
| Boot-time provisioning race across replicas        | One-shot `scripts/provision-existing-orgs.ts` behind advisory lock; remove from boot entirely after cutover |
| Cross-DB orphan user references                    | Hook on `OrganizationMembership` delete + `User` delete sweeps tenant DBs via `scripts/cleanup-user-refs.ts` |
| S3 object orphans after org deletion               | `scripts/purge-orphan-s3.ts` sweeps `vault-files/<orgId>/` prefixes for orgs not present in `organization` |
| Provisioning fails mid-flow                        | Tenant row left in `status='provisioning'`; admin retry endpoint; user sees waiting page |

## Observability

- Per-tenant tags on logs: `orgId`, `tenantDbName`, `schemaVersion`.
- Metrics: tenant client cache hit/miss, p95 query latency per tenant, error
  rate per tenant, RSS of app process, cache size.
- Neon billing export → per-tenant compute and storage attribution. Informs
  per-plan pricing tiers later.
- Alerts:
  - provisioning failures (>0 in 5m window)
  - `schema_version` drift persisting >1h on any active tenant
  - tenant DB unreachable (>1% error rate for 5m)
  - `TENANT_DSN_ENC_KEY` decrypt failure (any)

## Open questions (now answered)

1. **Does `api_key` stay in control plane?** **Yes.** Keys are user-scoped
   identity, not tenant data. The existing `ApiKey.organizationId` column is
   denormalized org routing info — the `/api/mcp` path uses it to resolve
   the tenant client without an extra join. Revisit if enterprise requires
   per-org key isolation (unlikely — enterprises want key fan-out, not
   fan-in).
2. **Do we need a separate management role for provisioning vs day-to-day?**
   **Yes.** `neon_admin` (Neon's default project owner role) is used by
   `provisionTenant` via the Neon HTTP API. `org_<cuid>_app` is used at
   runtime, has no CREATE DATABASE privilege, and is scoped to one DB.
3. **Where does the Neon admin credential live?** `NEON_API_KEY` (Railway
   secret) — used only by `provisionTenant` and `scripts/tenant-migrate.ts`.
   No raw-SQL admin DSN is stored; management ops go through the Neon API.
4. **Do we keep RLS at all in the tenant DB?** **Yes, at brain level.** The
   DB boundary handles org isolation; RLS handles brain-access defense-in-depth
   within an org. See Phase 1.6.
5. **Pooled or direct DSN for runtime?** **Pooled at runtime, direct for
   migrations only.** Both stored on `Tenant`.
6. **LRU cache vs per-request Prisma clients via Neon serverless adapter?**
   **Benchmark in Phase 1, decide before Phase 3.** Default plan: LRU. Switch
   if Neon serverless adapter + Prisma proves stable and RAM headroom on
   Railway becomes the bottleneck.

## Next actions (ordered checklist)

1. Create Neon project `aju` in eu-central-1; capture `NEON_API_KEY`,
   `NEON_PROJECT_ID`, both control DSNs.
2. Add env vars to `.env.example` and Railway.
3. Generate `TENANT_DSN_ENC_KEY`; store in Railway.
4. Branch `neon-phase-1` in aju repo. Split `prisma/schema.prisma` into
   `prisma/control/schema.prisma` and `prisma/tenant/schema.prisma`.
5. Update `postinstall`, `build`, `db:migrate:*` scripts.
6. Schema surgery: denormalize cross-DB user/agent refs; drop
   `organization_id` from tenant tables (Phase 1.5).
7. Rewrite `prisma/tenant/rls-policies.sql` with brain-id policies
   (Phase 1.6).
8. Rewrite `src/lib/tenant-context.ts` with `withBrainContext`; delete
   `withOrgContext`.
9. Write `src/lib/tenant-provision.ts` and wire it into the three org-create
   call sites.
10. Write `scripts/tenant-migrate.ts` and
    `scripts/provision-existing-orgs.ts`.
11. Benchmark LRU vs Neon serverless adapter in a throwaway branch.
12. Phase 3 mechanical rewrite: 38 call sites + `mcp/aju-server.ts`.
13. Deploy, backfill, cutover.
