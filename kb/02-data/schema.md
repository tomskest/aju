---
title: Prisma schema
description: Every model across the control and tenant schemas, its purpose, and its relationships.
order: 20
---

# Prisma schema

The schema is split in two. One file per plane, one generated client per file:

- **`data/control/schema.prisma`** → `@prisma/client`. Holds global identity
  (User, Session, Account, Verification), organizations (Organization,
  OrganizationMembership, Invitation, OrganizationDomain, AccessRequest),
  OAuth (OAuthClient, OAuthAuthorizationCode), programmatic auth (ApiKey,
  DeviceCode), beta overflow (WaitlistEntry), and the `Tenant` routing table
  that pins an org to its per-tenant Postgres DB.
- **`data/tenant/schema.prisma`** → `@prisma/client-tenant`. Applied to every
  per-org tenant database. Holds Brain, BrainAccess, Agent, VaultDocument,
  DocumentLink, VaultChangeLog, VaultFile.

The organization boundary IS the database boundary. There is no
`organization_id` column on the tenant tables — a row exists in a given DB
because it belongs to that org, full stop. Cross-DB FKs back to control
tables (`User`, `Organization`) are impossible in Postgres, so user / agent
references on `BrainAccess.userId`, `Agent.createdByUserId`,
`VaultFile.uploadedBy`, and `VaultChangeLog.actorId` are denormalized as
plain strings with no FK. App-layer cleanup hooks keep them consistent on
user delete / membership removal.

RLS inside each tenant DB gates on `brain_id` via the session variable
`app.current_brain_ids` (see [tenant-isolation.md](./tenant-isolation.md)).

## Tenant routing (control plane)

### `Tenant` (`data/control/schema.prisma`)

Maps an organization to its per-tenant database. Created by
`provisionTenant(orgId)` at org-create time, read by `tenantDbFor(orgId)` on
every request.

```prisma
model Tenant {
  id             String @id @default(cuid())
  organizationId String @unique
  databaseName   String           // "org_<cuid>"
  region         String @default("aws-eu-central-1")

  // AES-GCM encrypted with TENANT_DSN_ENC_KEY.
  dsnDirectEnc String             // Prisma migrate / DDL
  dsnPooledEnc String             // runtime (PgBouncer, transaction mode)

  schemaVersion  Int       @default(0)
  lastMigratedAt DateTime?
  status         String    @default("provisioning") // provisioning | active | suspended | archived
  createdAt      DateTime  @default(now())

  organization Organization @relation(...)
}
```

**Why two DSNs.** The direct DSN is needed for Prisma schema pushes (prepared
statements, session state). The pooled DSN goes through PgBouncer in
transaction mode — the default runtime path. `tenantDbFor` hands the pooled
DSN to the cached `PrismaClient`.

**Why `schemaVersion`.** Bumped by `scripts/tenant-migrate.ts` after a
successful deploy. The app compares this against a code-side constant
(`CURRENT_TENANT_SCHEMA_VERSION`) at request time; drift throws
`TenantSchemaDriftError` from `tenantDbFor` until the migration runs.

## Brains and content (tenant plane)

### `Brain` (`data/tenant/schema.prisma`)

A brain is a namespace. Everything content-shaped — documents, files, the
link graph, the change log, access rows — hangs off exactly one brain.

```prisma
model Brain {
  id         String   @id @default(cuid())
  name       String
  type       String   @default("org") // org | personal
  createdAt  DateTime @default(now())

  documents  VaultDocument[]
  links      DocumentLink[]
  files      VaultFile[]
  changeLogs VaultChangeLog[]
  access     BrainAccess[]
}
```

**Why two types:** a personal brain is the per-user default vault; an org
brain is shared team memory. The `type` is a string, not an enum, so new
brain kinds ("agent scratch", "project", etc.) can be added without a
schema migration.

**Why no `organizationId` column.** The database itself is the org
boundary. Every row in this tenant DB belongs to this org by construction.

### `BrainAccess` (`data/tenant/schema.prisma`)

The ACL row that links a user *or* an agent to a brain with a role:
`owner | editor | viewer`. Exactly one of `userId` or `agentId` is set —
the `brain_access_actor_xor` CHECK constraint in
`data/tenant/rls-policies.sql` enforces this at the DB layer.

`userId` is a denormalized plain string (no FK) because `User` lives in the
control DB and cross-DB FKs are not possible. App-layer cleanup on user
delete / membership removal sweeps these references.

`@@unique([brainId, userId])` prevents duplicate user-level access rows.
Agent access rows are intentionally not constrained this way.

### `Agent` (`data/tenant/schema.prisma`)

A named programmatic identity scoped to one org (one tenant DB). Useful for
giving a bot a distinct audit trail (`VaultChangeLog.actorType="agent"`)
without burning a user seat. `createdByUserId` records provenance as a
denormalized string reference to the control DB. `status` lets an admin
pause or revoke without deletion (`active | paused | revoked`).

### `VaultDocument` (`data/tenant/schema.prisma`)

The heart of the system. Every markdown file in the vault is one row.

Key columns:

- `path` — the vault-relative path, e.g. `06-Sales/Prospect-Profiles/Foo.md`.
  Unique within a brain (`@@unique([brainId, path])`).
- `content` — the raw markdown including frontmatter. `@db.Text` so there's
  no length cap.
- `contentHash` — SHA-256 of the raw bytes, used for cheap equality checks
  when syncing between a local CLI and the server.
- `frontmatter` — parsed YAML from the top of the file, stored as JSONB.
- `docType` / `docStatus` — hoisted out of frontmatter for cheap index scans.
- `tags`, `wikilinks` — denormalised arrays so list endpoints don't have to
  join the link table for every read.
- `wordCount`, `directory`, `section` — computed on write by
  `src/lib/vault-parse.ts`.
- `fileModified` — a user-supplied mtime from the CLI; distinct from
  `updatedAt`, which the DB stamps on every write.

**Why denormalise `tags` and `wikilinks`:** the common read path is "give me
all docs with tag X" or "show the wikilinks on this doc". Postgres arrays
are fine for both and avoid a second round-trip.

### `DocumentLink` (`data/tenant/schema.prisma`)

The resolved wikilink graph: one row per `(sourceId, targetId, linkText)`.
Rebuilt from scratch per-brain after every document write by
`src/lib/rebuild-links.ts`; the cost is small (~1-2s for a few hundred
documents) and the alternative — incremental maintenance with edge cases
around renames, ambiguous basenames, and broken links — is significantly
more code.

### `VaultChangeLog` (`data/tenant/schema.prisma`)

Append-only audit log. One row per vault write: `insert | update | delete`
for documents, `file-upload | file-delete` for binaries. Records `source`
(which client — cli, mcp, web), `changedBy` (user or agent identifier), and
`actorType` / `actorId` for typed audit trails. `actorId` is a denormalized
string — the referenced User lives in the control DB.

**Why `documentId` is nullable with `onDelete: SetNull`:** deleting a
document should keep the change log intact so the audit trail never lies.
Without `SetNull` a delete would either orphan the log row (FK violation)
or cascade-wipe history.

### `VaultFile` (`data/tenant/schema.prisma`)

Metadata for every binary uploaded to the vault. The bytes themselves live
in object storage under `s3Key` (see [files-and-storage.md](./files-and-storage.md)). The
database stores the filename, mime type, size, category, tags, the extracted
plain-text for text/PDF files, and the SHA-256 `textHash` for dedup.
`uploadedBy` is a denormalized string (no FK — the User lives in control).

`s3Key` is unique within this tenant DB — it encodes
`<brain_name>/files/<category>/<filename>` so renaming a brain would break
keys. That's a known constraint; the system never renames the S3 side.

## Identity (control plane, Better-Auth)

### `User` (`data/control/schema.prisma`)

Standard Better-Auth fields (`id`, `email`, `emailVerified`, sessions,
accounts) plus three aju-specific fields:

- `grandfatheredAt` — set when a user is granted legacy pricing during the
  beta. Indexed so cohort queries are cheap.
- `planTier` — `free | paid | platform_admin | beta_legacy` (string for
  forward compatibility).
- `personalOrgId` — points at the user's personal org (created by the
  backfill or signup flow). `@unique` because a user has exactly one
  personal org.

### `Session` / `Account` / `Verification`

Managed by Better-Auth (`src/lib/auth.ts`). Sessions store `ipAddress` and
`userAgent` for audit. Accounts hold OAuth tokens. Verification holds
email-verification challenges.

## CLI / API-key auth (control plane)

### `ApiKey` (`data/control/schema.prisma`)

Represents a CLI or MCP client credential. The `prefix` (first 12 chars of
the plaintext) is the only part shown to the user after creation and is
stored plaintext for lookup; the rest is scrypt-hashed
(`<salt-hex>:<hash-hex>`). `scopes` defaults to `["read","write"]` and is
JSONB so future scopes land without a migration.

**`organizationId` is required at mint time.** Every key is pinned to exactly
one org — the mint endpoint (`POST /api/keys`), the dashboard UI, and the
CLI `--org` flag all enforce this. The key's requests always route to that
one org's tenant DB via `tenantDbFor(row.organizationId)`.

### `DeviceCode` (`data/control/schema.prisma`)

Implements the OAuth-style device-code flow used by `aju login`. A CLI asks
the server for a pair of codes, the user approves the `userCode` in a
browser, and the CLI polls until it gets back an `apiKeyPlaintext`.
`apiKeyPlaintext` is stored briefly and cleared on retrieval — an
unavoidable window, documented in code.

## Organizations (control plane)

### `Organization` (`data/control/schema.prisma`)

The tenant. Every user ends up with an `isPersonal=true` org (their default)
and can optionally own/belong to shared orgs. `slug` is URL-safe and unique.
`autoAcceptDomainRequests` lets an org auto-admit new users whose email
domain is verified against `OrganizationDomain`. Creation triggers
`provisionTenant(orgId)` which creates the org's per-tenant database.

### `OrganizationMembership` (`data/control/schema.prisma`)

Join table between users and orgs with a role (`owner | admin | member`) and
an `acceptedAt` timestamp for tracking whether a pending invite has been
redeemed.

### `Invitation` (`data/control/schema.prisma`)

Email + `tokenHash` + `expiresAt`. Only the hash is stored; the plaintext
token ships in the invite URL and is compared via hash on accept.

### `OrganizationDomain` (`data/control/schema.prisma`)

Claimed email domains. `verificationMethod` can be `email_match`, `dns_txt`,
or `admin_override`. Lets the app auto-route access requests to the right
org.

### `AccessRequest` (`data/control/schema.prisma`)

"I want to join your org." Unique on `(organizationId, requestingUserId)`
so a user can't flood an org with duplicate requests.

## Beta overflow

### `WaitlistEntry` (`data/control/schema.prisma`)

Email capture for the landing page. `position` is a `BigInt` autoincrement
so display order is stable even as rows get marked `invitedAt`.
