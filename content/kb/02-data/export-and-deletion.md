---
title: Export and deletion
description: Signout, brain delete, and the /api/me/export endpoint — how data actually leaves aju.
order: 70
---

# Export and deletion

aju's data-rights posture is blunt: your content is yours, you can pull a
full portable copy at any time, and deletion is real.

## Export: `GET /api/me/export`

`src/app/api/me/export/route.ts`. Returns a single JSON document
containing:

- The user profile (`id, email, name, grandfatheredAt, planTier, createdAt`).
- Every brain the user **owns** across every org they're a member of
  (`BrainAccess.role = "owner"` in that org's tenant DB):
  - `id, name, type, organizationId, createdAt`.
  - Every document: `path, title, frontmatter, tags, wikilinks, content,
    docType, docStatus, createdAt, updatedAt`.
  - Every file's **metadata**: `s3Key, filename, mimeType, sizeBytes,
    category, tags, extractedText, metadata, createdAt, updatedAt`.

The handler walks `OrganizationMembership` rows from the control DB, opens
`tenantDbFor(organizationId)` for each, and gathers owner brains from that
tenant DB. Orgs whose tenant is unreachable are skipped with a log line;
the rest of the export still runs.

The response sets `Content-Disposition: attachment` so a browser saves it
with a dated filename. Format marker: `"format": "aju-export-v1"`.

### What's in and what's out

**In:**
- Full markdown content of every owned document, including frontmatter.
- Every extracted plain-text body for files (PDFs as parsed text, text
  files as-is).
- All structured metadata.

**Out (intentionally):**
- Binary file contents. `s3Key` is included so the user can call
  `GET /api/vault/files/read?key=<s3Key>&mode=url` or
  `aju files read <key> --mode content` to retrieve the bytes separately.
  The JSON would otherwise balloon to gigabytes for users with many PDFs.
- Documents from brains the user does not **own**. Shared team-brain
  content belongs to the org, not to an individual export.
- Change log entries — not yet in the v1 format. `TODO: verify` whether
  they should be added to v2.
- Embeddings — regeneratable from content, not worth including.

The promise in the route comment:

> Promise to users: this endpoint stays stable and usable for as long as
> the service exists. It is the mechanism that makes "your data is yours"
> a real commitment — not a marketing line.

**Why JSON and not a tarball of markdown files:** JSON is a single
round-trip, is structurally lossless for frontmatter / tags / wikilinks,
and is trivially scriptable. Reconstituting a markdown vault from the JSON
is a 20-line script — the CLI's `aju export` command does exactly that.

## Signout: `POST /api/auth/signout`

`src/app/api/auth/signout/route.ts`. Clears the session cookie and the
`active-organization` cookie, then redirects to `/`.

Important: **signout does not delete anything**. Brains, documents, files,
api keys, and access rows all survive. Signout is a session-only operation.

## Brain deletion: `DELETE /api/brains/[id]`

`src/app/api/brains/[id]/route.ts`. Owner-only. Includes a last-brain
guard — see [brains.md](./brains.md).

Delegates the actual teardown to `deleteBrainWithStorage(tenant, brainId)`
in `src/lib/brain-delete.ts`. The sequence:

1. **Enumerate R2 keys from the tenant DB.**
   `tenant.vaultFile.findMany({ where: { brainId }, select: { s3Key: true } })`.
   The DB is the source of truth for which objects belong to the brain —
   no reliance on `ListObjectsV2` against the bucket prefix.
2. **Batch-delete from R2.** Keys are chunked at **1000 per
   `DeleteObjectsCommand`** (the S3 batch-delete cap) and dispatched
   sequentially. Per-key errors and batch failures are collected as
   `r2Warnings` but do **not** abort the DB delete — orphaned objects
   are recoverable via bucket lifecycle / manual sweep; orphaned DB
   pointers are not.
3. **Drop the Brain row in the tenant DB.** Schema-level cascades then
   wipe:
   - `BrainAccess` rows → cascade.
   - `VaultDocument` rows → cascade.
   - `DocumentLink` rows → cascade (via document FK).
   - `VaultFile` rows → cascade.
   - `VaultChangeLog` rows → the `documentId` FK sets to `NULL`; the rows
     stay behind as historical audit.

**Why R2 first, DB after:** if the DB drop failed after a partial R2
wipe, the `VaultFile` rows would still be present and the user could
retry. The inverse — DB gone, objects orphaned with no way to enumerate
them — is the failure mode we refuse to tolerate (it's both a cost leak
and a privacy leak).

## Organization deletion: `deleteOrganizationWithStorage(orgId)`

Used by `/api/me/delete` and the org-settings delete action. Drops the
whole tenant DB in one move:

1. Open the tenant client via `tenantDbFor(orgId)`. Enumerate every brain,
   wipe each brain's S3 objects (same 1000-per-batch loop). If the tenant
   DB is already gone from a prior failed attempt, the S3 wipe is skipped
   with a warning — we can't enumerate; the bucket lifecycle / manual
   sweep picks up stragglers.
2. `evictTenantClient(orgId)` so no cached `PrismaClient` still holds
   open connections.
3. `destroyTenant(orgId)` calls the Neon HTTP API to drop the database
   and the `org_<cuid>_app` role, then deletes the tenant row. 404 from
   Neon (already gone) and P2025 from Prisma (row already gone) are
   swallowed — the call is idempotent.
4. Delete the `Organization` row in the control DB. `OrganizationMembership`,
   `Invitation`, `OrganizationDomain`, `AccessRequest`, `ApiKey`,
   `DeviceCode` all cascade on the org FK.

Partial-failure retries are safe at every step.

## File deletion: `POST /api/vault/files/delete`

`src/app/api/vault/files/delete/route.ts`. Logs the delete to
`VaultChangeLog` **first**, then calls `deleteFromS3(key)`, then deletes
the `VaultFile` row. Order matters:

1. Log first so the audit trail survives an S3 failure.
2. S3 delete next so the bytes are gone even if the DB operation after it
   fails.
3. DB delete last so orphaned R2 objects don't linger under an orphaned
   metadata row.

## Document deletion: `POST /api/vault/delete`

`src/app/api/vault/delete/route.ts`. Logs the operation, deletes the
`VaultDocument` (which cascades `DocumentLink` rows), then fires
`rebuildLinks(tenant, brainId)` to recompute the graph. The changelog row
persists with `documentId=NULL` via the `SetNull` on the FK
(`prisma/tenant/schema.prisma`).

## Account deletion: `DELETE /api/me/delete`

`src/app/api/me/delete/route.ts`. Self-service. `POST` is accepted as
an alias for clients that can't easily issue `DELETE` with a body.
Idempotent — a second call has no signed-in user and returns `401`
rather than erroring.

The handler tears down the caller's footprint in four phases:

1. **Orgs the user owns** — for every `Organization` where
   `ownerUserId = userId` (including the user's personal org),
   `deleteOrganizationWithStorage` wipes each brain's R2 objects, drops
   the tenant DB via `destroyTenant`, and deletes the org row in the
   control DB. If any org delete fails, the error is captured as a
   warning and the remaining phases still run.
2. **Memberships in orgs the user doesn't own** —
   `OrganizationMembership.deleteMany({ where: { userId } })`. The orgs
   themselves keep running; the user simply leaves. BrainAccess rows in
   those orgs' tenant DBs still reference this `userId` as a
   denormalized string — harmless once the membership is gone (nothing
   queries them for this user), and a background reaper can sweep them
   up later.
3. **Delete the `User` row** in the control DB. `Session`, `Account`,
   `ApiKey` all cascade on `User` delete per `prisma/control/schema.prisma`.
4. **Clear the session + active-org cookies.** The caller is signed
   out on return.

Response shape:

```json
{
  "ok": true,
  "brainsDeleted": 3,
  "orgsDeleted": 1,
  "r2ObjectsDeleted": 47,
  "r2Warnings": []
}
```

`r2Warnings` surfaces any per-key or batch failures from the R2 wipe
(and any org-delete failures from phase 1). A non-empty warnings array
is the signal to run a bucket sweep — the user row is still deleted.

**What survives an account delete:**

- Orgs the user was only a *member* of — they keep running with their
  remaining members.
- `VaultChangeLog` rows referring to the user's past writes in those
  orgs' tenant DBs — the `changedBy` / `actorId` strings are kept as
  audit history; there is no bulk rewrite.

**Export first if you want a copy.** The delete is destructive and has
no undo. The CLI's `aju account delete` prompts for confirmation and
recommends running `aju export` beforehand.

## Retention defaults

- **Sessions** — expire per Better-Auth's `expiresAt`. No active sweep; a
  cron could be added.
- **Verifications** — same (`Verification.expiresAt`).
- **Invitations** — `expiresAt` set on create; cron cleanup
  `TODO: verify`.
- **Device codes** — `expiresAt` on create, indexed with
  `(status, expiresAt)` for the cleanup query
  (`prisma/control/schema.prisma`).
- **Access requests** — `expiresAt` required on create.
- **Change log** — no TTL. Retained for the life of the brain.
- **Waitlist entries** — no TTL.
