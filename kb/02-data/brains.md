---
title: Brains as namespaces
description: Personal vs org brains, access roles, and how brain resolution works on every request.
order: 30
---

# Brains as namespaces

A **brain** is aju's unit of isolation for content *inside one organization*.
The org boundary is the database itself; a brain is one namespace within
that database. Documents, files, the wikilink graph, and the change log all
hang off a single brain (`data/tenant/schema.prisma`). Users access brains
through `BrainAccess` rows — which live in the same tenant DB — that grant
a role.

Two kinds:

- **Personal brain** (`type="personal"`) — default, per-user vault. Every
  signed-in user gets one.
- **Org brain** (`type="org"`) — shared team memory inside an organization.

`type` is a string so new kinds ("agent scratch", "project", ...) can be
added without a migration.

## IDs and names

- `id` is a `cuid` — server-generated, never exposed in URLs as the primary
  identifier.
- `name` is what users see and what the CLI passes around (`?brain=work`).
  Names are not globally unique; they're unique per-user-per-org through the
  `BrainAccess` join.

The S3 layout encodes the brain *name* (not id) into the object key — see
`src/app/api/vault/files/presign-upload/route.ts:36`:

```
<brainName>/files/<category>/<filename>
```

**Tradeoff:** this makes bucket layout human-browsable but means a brain
rename would strand all its files under the old prefix. The product treats
brain renames as a rare operation and accepts the constraint.

## Access roles

`BrainAccess.role` is one of `owner | editor | viewer`
(`data/tenant/schema.prisma`). The `canWrite` helper in `src/lib/brain.ts`
collapses this to "can this request mutate?":

```ts
export function canWrite(ctx: BrainContext): boolean {
  return ctx.accessRole === "owner" || ctx.accessRole === "editor";
}
```

Every write endpoint calls `canWrite(brain)` before touching the DB.
Viewers 403.

## Brain resolution

`src/lib/brain.ts` — `resolveBrain(tenant, req, auth)` — decides which brain
a request targets. It runs against the already-resolved tenant DB (the org
is pinned on the API key), so every lookup is implicitly scoped to that one
org. Precedence:

1. **Explicit `?brain=<name>`**
   - If the caller has a userId, look up `BrainAccess(userId, brain.name)`
     in the tenant DB. Not found → 403.
   - If the caller has no userId (legacy env-var auth used by the
     single-tenant CLI), fall back to a name-only brain lookup.
2. **Authenticated user, no explicit brain** — prefer their personal brain,
   else the first accessible brain ordered by `createdAt` asc.
3. **No user context at all** — return the first org brain, else any brain.

Cross-org filtering is not needed at this layer — the tenant DB already
contains only this org's brains. The legacy env-var path walks the same
tenant DB in unscoped mode.

**Why this order:** the CLI's default invocation (`aju read ...` with no
`--brain`) should land in the user's personal brain without them configuring
anything. Explicit `--brain foo` overrides. The "no user at all" branch
exists for self-hosted deployments running against a single shared org.

### "All brains" mode

Some endpoints (changes feed, search) accept `?brain=all` and fan out across
every brain the caller has access to *within the resolved tenant DB*.
`resolveAccessibleBrainIds(tenant, auth)` in `src/lib/brain.ts` returns
every brainId from the caller's `BrainAccess` rows in that DB.

## Creating and deleting brains

### POST `/api/brains` (`src/app/api/brains/route.ts`)

Creates a brain and the owner's `BrainAccess` row inside the caller's tenant
DB, in a single `withTenant` transaction. Requires a signed-in user
(env-var callers can't create brains). The target tenant DB is resolved
from `auth.organizationId` (pinned key), the `active-organization` cookie,
or the user's personal org.

### DELETE `/api/brains/[id]` (`src/app/api/brains/[id]/route.ts`)

Owner-only. A **last-brain guard** refuses the delete if this is the
caller's only owned brain:

```ts
if (ownedCount <= 1) {
  return NextResponse.json({
    error: "last_brain",
    message: "you can't delete your only owned brain — create another one first.",
  }, { status: 409 });
}
```

**Why:** a fresh account should never end up with nowhere to write. The CLI
defaults would break, and the web UI has no "create brain" entry point that
assumes zero brains.

Cascades on delete (configured at the tenant-schema level,
`data/tenant/schema.prisma`):

- `BrainAccess` → cascade.
- `VaultDocument` → cascade.
- `VaultFile` → cascade (DB row only — S3 objects are wiped separately by
  `deleteBrainWithStorage`; see [export-and-deletion.md](./export-and-deletion.md)).
- `DocumentLink` → cascade via document.
- `VaultChangeLog` → `onDelete: SetNull` on the document FK keeps audit
  history; the log rows stay behind with `documentId=null`.

## Viewer access via org membership

`loadAccessibleBrain` in `src/app/api/brains/[id]/route.ts` grants a
**viewer** role to any org member who doesn't have an explicit
`BrainAccess` row in the tenant DB. The org-membership check runs against
the control DB. This keeps team-brain browsing friction-free: new members
can see the brain immediately; editor/owner needs an explicit grant.

## Rename

PATCH `/api/brains/[id]` (`src/app/api/brains/[id]/route.ts`) renames a
brain. Owner-only, 64-char max. Does **not** rewrite S3 keys; see the
tradeoff note above.
