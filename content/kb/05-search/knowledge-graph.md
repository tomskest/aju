---
title: Knowledge graph
description: Wikilink parsing, the DocumentLink table, full-rebuild strategy, 2-hop graph expansion, and the deep-search GraphRAG query.
order: 60
---

# Knowledge graph

Vectors answer "what's similar". The graph answers "what did the author
deliberately connect". Two different questions; aju maintains both.

The graph is built from `[[wikilinks]]` embedded in the markdown — the
Obsidian / Roam / Logseq convention. Whenever a document mentions
another by filename (with or without path), that's an edge.

## Why a link graph on top of vectors

A user writing `[[Hamburg Cluster]]` inside a prospect note is
asserting a relationship the embedding model may or may not capture.
That's cheap structured signal, so aju materialises it. Practical
uses:

- **Backlinks**: "which notes link here?" — answers questions like
  "what do we know about this company?" by surfacing every place it's
  referenced.
- **Related**: outgoing links + incoming links + shared tags, merged
  and deduplicated.
- **Deep search (GraphRAG)**: seed the retrieval with a hybrid search,
  then walk 1–2 hops out to pull in connected-but-different-wording
  documents. Picks up context a vector search would miss.
- **Orphan detection**: notes with zero in- and out-edges are often
  abandoned stubs.

## Parsing wikilinks

`src/lib/vault-parse.ts:19`

```ts
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
```

Matches `[[Foo]]` and the aliased form `[[Foo|display text]]`, capturing
the target (`Foo`). The alias text is discarded — aju tracks the edge,
not the surface display.

Extracted wikilinks are deduplicated and stored on the document row as
a string array:

```ts
// src/lib/vault-parse.ts:75
wikilinks: [...new Set(wikilinks)]
```

Denormalising onto the document lets the read path render a file
without a JOIN. The resolved edges live in `document_links` and are
rebuilt from these strings whenever the graph is invalidated.

## Resolution

Wikilinks are names, not paths. `[[C Teleport]]` could resolve to
`07-GTM-Strategy/Competitors/C-Teleport.md` or
`03-Product/Integrations/C-Teleport.md` or neither. Resolution lives
in `src/lib/link-resolver.ts`.

Strategies, in order (`resolveLinks` at `link-resolver.ts:47`):

1. **Path-based** — if the link contains `/`, try it as an absolute
   vault path; if that doesn't match, try relative to the source
   document's directory.
2. **Basename lookup, normalised** — lowercase the name, replace
   hyphens with spaces; match against a global basename map
   (`buildBasenameMap`). This is what makes `[[C Teleport]]` resolve
   to `C-Teleport.md`.
3. **Exact basename** — lowercase but skip the hyphen→space swap.
4. **Path with `.md` appended** — last-chance fallback.

### Ambiguity handling

If two documents share a normalised basename, the map stores `null`
for that key and the link is treated as unresolved rather than
guessing.

```ts
// src/lib/link-resolver.ts:25
if (map.has(normalized)) {
  map.set(normalized, null);  // ambiguous — don't resolve
}
```

Deliberate: a guess that silently picks the wrong doc is worse than an
honest "can't resolve, the user should disambiguate with a path".

### Heading anchors

`[[Doc#Section]]` is stripped to `[[Doc]]`. aju does not currently
track heading-level anchors (TODO: consider for deeper navigation).

## The `document_links` table

Lives in every tenant DB. `prisma/tenant/schema.prisma:123`:

```prisma
model DocumentLink {
  id       String @id @default(cuid())
  brainId  String @map("brain_id")
  sourceId String @map("source_id")   // vault_documents.id
  targetId String @map("target_id")   // vault_documents.id
  linkType String @default("wikilink") @map("link_type")
  linkText String @map("link_text")   // the raw [[…]] body as written

  brain  Brain         @relation(fields: [brainId], references: [id])
  source VaultDocument @relation("outgoing", fields: [sourceId], references: [id], onDelete: Cascade)
  target VaultDocument @relation("incoming", fields: [targetId], references: [id], onDelete: Cascade)

  @@unique([sourceId, targetId, linkText])
  @@index([brainId])
  @@index([sourceId])
  @@index([targetId])
  @@index([linkType])
  @@map("document_links")
}
```

No `organizationId` column — the tenant DB itself IS the org boundary.
Access from code goes through the tenant client:
`tenantDbFor(orgId).documentLink.*` for one-off writes, or `tx.documentLink.*`
inside a `withTenant` transaction.

One row per resolved edge. `linkText` is preserved so two different
aliases linking the same pair are distinguishable (a UI might want to
show both).

`linkType` exists for future-proofing — `wikilink` is the only value
today. Candidates: `mention` (markdown reference), `embed`, `implicit`
(inferred from co-occurrence).

## Write-side: full rebuild

`src/lib/rebuild-links.ts:14`

```ts
export async function rebuildLinks(
  tenant: PrismaClientTenant,
  brainId?: string,
) {
  const allDocs = await tenant.vaultDocument.findMany({
    where: brainId ? { brainId } : {},
    select: { id: true, path: true, wikilinks: true, brainId: true },
  });

  const allPaths = allDocs.map(d => d.path);
  const basenameMap = buildBasenameMap(allPaths);

  // Nuke and repave
  if (brainId) {
    await tenant.documentLink.deleteMany({ where: { brainId } });
  } else {
    await tenant.documentLink.deleteMany({});
  }

  for (const doc of allDocs) {
    const { resolved } = resolveLinks(doc.wikilinks, doc.path, allPathsSet, basenameMap);
    if (resolved.length > 0) {
      await tenant.documentLink.createMany({
        data: resolved.map(l => ({
          sourceId: doc.id,
          targetId: pathToId.get(l.targetPath),
          linkType: "wikilink",
          linkText: l.linkText,
          brainId: doc.brainId,
        })),
        skipDuplicates: true,
      });
    }
  }
}
```

Note the signature: the function takes a `PrismaClientTenant` first
argument. Since the split to one-DB-per-org there is no global `prisma`
client that spans brains — callers resolve the right tenant client via
`tenantDbFor(organizationId)` and pass it in. Inside API routes and MCP
tools you typically already have it from `withTenant(...)` and can hand
`tenant` straight through.

**Why full delete + recreate** (comment at `rebuild-links.ts:6`):

> Fast for ~300 docs (~1-2s). The alternative — incremental maintenance
> with edge cases around renames, ambiguous basenames, and broken
> links — is significantly more code.

A rename is the worst incremental case: every document that linked to
the old filename now points at a different (or no) target. With a
global basename map, a full rebuild handles rename, ambiguity, and
broken-link detection in one pass. The constant factor is small
because the link count grows roughly linearly with document count.

### When it runs

Fire-and-forget after every create/update/delete, with the tenant
client passed in:

```ts
// src/app/api/vault/create/route.ts (post-commit)
rebuildLinks(tenant, brainId).catch((err) =>
  console.error("Link rebuild after create failed:", err)
);
```

(Same shape in `update/route.ts`, `delete/route.ts`, and the MCP
`aju_create` / `aju_update` / `aju_delete` handlers in
`src/lib/mcp/tools.ts`.)

Also exposed as `/api/cron/rebuild-links` for explicit re-sync after
bulk imports — that route iterates active tenants and calls
`rebuildLinks(tenantDbFor(orgId))` for each.

## Read-side endpoints

### Backlinks — `/api/vault/backlinks`

`src/app/api/vault/backlinks/route.ts`. Returns everything that points
*at* a given path. One Prisma query against the tenant transaction:

```ts
// inside withTenant({ organizationId, userId }, async ({ tx }) => { ... })
const links = await tx.documentLink.findMany({
  where: { targetId: doc.id },
  include: { source: { select: { path, title, section, docType, docStatus, tags } } },
});
```

The MCP `aju_backlinks` tool runs the same query
(`src/lib/mcp/tools.ts:907-922`) against the same `tx` after
`resolveBrainForTool` picks the brain.

### Related — `/api/vault/related`

`src/app/api/vault/related/route.ts`. Merges three lists:

1. Outgoing edges from the document.
2. Incoming edges to the document (same as backlinks).
3. **Tag neighbours** — docs sharing at least one tag, ranked by
   overlap count via a raw-SQL intersection:

```sql
-- src/app/api/vault/related/route.ts:76
SELECT path, title, section, doc_type,
       array_length(
         ARRAY(SELECT unnest(tags) INTERSECT SELECT unnest($2::text[])),
         1
       ) AS shared_tags
FROM vault_documents
WHERE id != $1 AND brain_id = $3 AND tags && $2::text[]
ORDER BY shared_tags DESC
LIMIT 20
```

The three sources are deduplicated by `path` — a doc reached via both
an incoming link and a shared tag appears once, with the first
relationship type winning in precedence order (outgoing → incoming →
tag).

### Graph — `/api/vault/graph`

Two modes, selected by `mode` param:

- `mode=stats`: total docs, total links, orphan count, top-20
  most-linked-to documents. Three separate queries, one being an
  `EXISTS` / `NOT EXISTS` pair for the orphan count.
- `mode=neighbors`: the 2-hop ego-network around a document, returned
  as `{nodes, edges}` for client-side graph rendering.

The 2-hop query is a recursive CTE
(`src/app/api/vault/graph/route.ts:128`):

```sql
WITH RECURSIVE neighbors AS (
  SELECT dl.source_id, dl.target_id, 1 AS hop
  FROM document_links dl
  WHERE dl.source_id = $1
  UNION
  SELECT dl.source_id, dl.target_id, 1 AS hop
  FROM document_links dl
  WHERE dl.target_id = $1
  UNION
  SELECT dl.source_id, dl.target_id, 2 AS hop
  FROM document_links dl
  JOIN neighbors n ON (dl.source_id = n.target_id OR dl.source_id = n.source_id
                    OR dl.target_id = n.target_id OR dl.target_id = n.source_id)
  WHERE n.hop = 1
    AND dl.source_id != $1 AND dl.target_id != $1
)
SELECT DISTINCT … FROM neighbors n
JOIN vault_documents src ON src.id = n.source_id
JOIN vault_documents tgt ON tgt.id = n.target_id
LIMIT 200
```

`LIMIT 200` caps the blast radius for hub documents (a doc linked
from 100 places has up to 10,000 2-hop neighbours).

## Deep search (GraphRAG)

`/api/vault/deep-search`
(`src/app/api/vault/deep-search/route.ts`). Combines hybrid search
with graph expansion. Wraps its work in `withTenant({ organizationId,
userId })` so every CTE and join runs against the caller's per-org
tenant DB transaction. Five steps:

1. **Seed via hybrid RRF** — identical query to
   `/api/vault/semantic-search?mode=hybrid`, `LIMIT $seeds` (default
   5).
2. **Expand seeds by 1–2 hops** — a single SQL query returns all
   neighbours of all seed documents, annotating each with which seed
   reached it and at what hop.
3. **Score neighbours by vector similarity** to the query embedding.
   Neighbours that happen to be semantically close to the query get
   promoted; weakly-related neighbours get pushed down.
4. **Blend scores**:
   ```
   score(seed)     = rrf_score / max_rrf   (normalised to 0-1)
   score(neighbor) = 0.5·similarity
                   + 0.3·graphProximity    (0.8 at hop 1, 0.5 at hop 2)
                   + 0.2·connectionDensity (fraction of seeds that reach it)
   ```
   Source at `deep-search/route.ts:281`.
5. **Unify and sort by score**, return top `$limit` with the graph
   edges between chosen results so a UI can draw the expansion.

The blend weights are hand-tuned, not learned. They encode the
hypothesis "a neighbour is worth promoting if (a) it's semantically
close to the query AND (b) it's highly connected to the seed set".
Noted for iteration.

## Operational notes

- Rebuild cost scales with total document count in the brain (or all
  brains if `brainId` is omitted). ~1–2s for hundreds of docs, grows
  linearly. Would need batching past ~10k documents; not there yet.
- A rebuild failure leaves `document_links` empty for the scope it
  was trying to rebuild. Re-running is safe (idempotent by design).
- Link resolution is synchronous within a rebuild; no Voyage or other
  external services involved, so a rebuild cannot fail on a network
  partition.
