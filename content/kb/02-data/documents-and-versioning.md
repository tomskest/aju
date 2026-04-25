---
title: Documents and versioning
description: Markdown storage, frontmatter parsing, wikilinks, and the change log.
order: 40
---

# Documents and versioning

Every note in a brain is a single row of `VaultDocument`
(`prisma/tenant/schema.prisma`). The document is stored verbatim as markdown
in the `content` column; everything else (title, tags, wikilinks, word
count, section, ...) is derived from that content on write.

## Storage format

- `content` — raw markdown, `@db.Text`, no length cap.
- `path` — vault-relative, forward-slash-normalised, e.g.
  `06-Sales/Prospect-Profiles/Foo.md`. Unique per brain
  (`@@unique([brainId, path])`).
- `frontmatter` — parsed YAML as JSONB (or `null` if the file has none).
- `contentHash` — SHA-256 of the raw bytes.

**Why keep the frontmatter both inside `content` and extracted to
`frontmatter`:** the raw markdown must be round-trippable so the CLI can
pull a doc, edit it, and push it back without losing formatting or field
ordering. The JSONB column is for cheap filtering / projection without
re-parsing on read.

## Parsing pipeline

`src/lib/vault-parse.ts:21` — `parseDocument(rawContent, filePath)` — runs
on every create and update. It:

1. Splits frontmatter from body with `gray-matter`.
2. Extracts the title: first `# H1` in the body, else `frontmatter.title`,
   else the filename without extension.
3. Normalises the path, derives `directory` and `section` (top-level dir,
   e.g. `06-Sales`).
4. Scans for wikilinks with `WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g`
   — captures the target, ignores pipe aliases.
5. Pulls `tags` from frontmatter (if it's an array).
6. Computes a word count on the body (frontmatter excluded).
7. Computes `contentHash = sha256(rawContent)`.

The returned `ParsedDocument` is written to the DB verbatim.

**Why derive so much on write:** reads dominate the workload. Computing
word counts, section membership, and wikilink arrays once at write time
makes list endpoints (browse, filter, sort) cheap.

## Wikilink parsing and resolution

Wikilinks look like `[[Target]]` or `[[Target|Alias]]`. The parser stores
just the target text on `VaultDocument.wikilinks`
(`src/lib/vault-parse.ts:44`). Resolution to a concrete `targetId` happens
separately, by `rebuildLinks()`.

### `rebuildLinks` (`src/lib/rebuild-links.ts`)

Invoked fire-and-forget after every document write with a tenant client
bound to the caller's org and the affected brain id. Full delete + recreate
of the `DocumentLink` table for that brain. It:

1. Loads every document's `(id, path, wikilinks, brainId)` from the tenant
   DB for that brain.
2. Builds a basename lookup map
   (`src/lib/link-resolver.ts` — `buildBasenameMap`). Basename
   collisions mark the entry ambiguous.
3. Deletes all existing links.
4. For each document, resolves each wikilink through three strategies
   (`src/lib/link-resolver.ts:47`):
   - Path-based: link contains `/`, match as absolute or relative to the
     source dir.
   - Basename with normalisation: lowercase and treat `-` as space, so
     `[[C Teleport]]` matches `C-Teleport.md`.
   - Exact basename fallback.
5. Inserts resolved links with `createMany(skipDuplicates: true)`.

**Why full rebuild:** correctness is easier than incremental maintenance.
With ~300 documents the full rebuild runs in a couple of seconds; below
that it's not worth the complexity of incremental diff logic, especially
around rename / delete cases.

## The change log

Every vault mutation writes a row to `VaultChangeLog`
(`prisma/tenant/schema.prisma`):

- `operation` — `insert | update | delete` for documents;
  `file-upload | file-delete` for binaries.
- `source` — which client drove the change: `cli`, `mcp`, `web`, etc.
- `changedBy` — the caller identity (user id or agent id string).
- `actorType` / `actorId` — structured audit fields for the same info.
- `path`, `documentId` — what was touched (document FK nullable with
  `SetNull` so deletes don't erase audit trail).

Writes happen inside the same `withTenant` transaction as the mutation:

```ts
return withTenant({ organizationId, userId }, async ({ tx }) => {
  const doc = await tx.vaultDocument.create({ data: ... });
  await tx.vaultChangeLog.create({ data: { operation: "insert", ... } });
  return doc;
});
```

See `src/app/api/vault/create/route.ts`,
`src/app/api/vault/update/route.ts`, and
`src/app/api/vault/delete/route.ts` for the three document operations.
Deletes log **before** deleting so the FK `SetNull` doesn't orphan the log
prematurely.

**Why not a full version history with prior content snapshots:** content
is rewritten in place on update. The change log captures operation, actor,
source, and timestamp — enough for audit — but not enough for "roll back to
last Tuesday". That's a deliberate scope choice: aju is an agent memory
backend, not a Git replacement. If you need content versioning, run your
vault out of a Git repo and sync with the CLI.

## Reading changes: `/api/vault/changes`

`src/app/api/vault/changes/route.ts` — `GET /api/vault/changes?since=<ISO>`
returns every change in the caller's tenant DB since a timestamp, optionally
filtered by excluding a source (`&excludeSource=cli` to skip your own writes
when syncing).

The response includes the current `content` and `contentHash` of each
document:

```ts
include: {
  document: { select: { content: true, contentHash: true } },
},
```

This is the sync primitive the CLI uses to pull remote changes: ask "what
happened since my last pull", apply them locally.

## Doc-type and status

`docType` and `docStatus` are hoisted out of frontmatter and indexed
(`prisma/tenant/schema.prisma`) so that listing "every prospect profile in
status=warm" is a single-column index scan.

These are soft fields — any string goes. The product doesn't enforce a
controlled vocabulary because the right vocabulary is user-specific.
