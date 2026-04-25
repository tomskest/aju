---
title: MCP tool surface
description: Every aju_* tool exposed over the remote MCP endpoint — parameters, return shapes, and the query each one runs.
order: 30
---

# MCP tool surface

Every tool lives in `src/lib/mcp/tools.ts`. Registration happens through
`registerAjuTools(server, ctx)` (`src/lib/mcp/tools.ts:308`), which attaches
the tool handlers to the per-request `McpServer`. `AJU_TOOL_COUNT` at the
bottom of the file (`src/lib/mcp/tools.ts:1122`) documents the expected
total (currently 10).

Every tool handler opens a per-request tenant transaction via
`withTenant({ organizationId, userId })` from `src/lib/tenant-context.ts`,
so each query runs against the correct org's Postgres with RLS pinned to
the caller's accessible brain ids. The context's `organizationId` is
required — post-split there is no cross-org fallback — and
`requireOrgId(ctx)` (`tools.ts:47-52`) enforces that up-front before any
DB work starts.

## Naming convention

All tools use the `aju_<verb>` prefix (`src/lib/mcp/tools.ts:5-11`) so the
LLM doesn't confuse them with other "search"/"read" tools on a host with
multiple MCP servers attached. A user with `aju` + `github` + `slack`
servers sees `aju_search` alongside `github_search_issues` — the prefix
keeps them disambiguated in the model's tool-selection step.

## Tool context

Each tool closure captures a shared `McpToolContext` (`src/lib/mcp/tools.ts:33-45`):
`{ userId?, organizationId, identity, defaultBrain? }`. The context is
built from the authenticated request at `src/app/api/mcp/route.ts:135-140`.
`organizationId` is non-optional — it selects the tenant DB.

## Tenant transaction wrapping

Every handler body is wrapped in `withTenant({ organizationId, userId })`:

```ts
return await withTenant(
  { organizationId, userId: ctx.userId },
  async ({ tx }) => {
    const b = await resolveBrainForTool(tx, ctx, brain);
    // …Prisma or raw-SQL queries against `tx`…
  },
);
```

`withTenant` (`src/lib/tenant-context.ts`) resolves the tenant Prisma
client via `tenantDbFor(orgId)`, looks up the caller's `BrainAccess`
rows in that tenant DB, and opens a transaction with
`SET LOCAL app.current_brain_ids = '<csv>'`. RLS policies in each tenant
DB read that session variable to filter rows by `brain_id`. The tool
body runs against `tx` — the transaction client — so every query is
both org-scoped (by DB) and brain-scoped (by RLS) automatically.

## Brain resolution

`resolveBrainForTool(tenant, ctx, requested)` (`src/lib/mcp/tools.ts:63-140`)
picks which brain a tool call operates on. The first argument is the
tenant client (or the open transaction), so all lookups happen inside
the correct per-org database:

1. If `requested` (or `ctx.defaultBrain`) is a specific name — resolve via
   `tenant.brainAccess.findFirst({ userId, brain: { name } })` to check the
   caller has access, and return `{ brainId, brainName, brainType, accessRole }`.
2. Otherwise — prefer the user's first `type: "personal"` brain (ordered by
   `createdAt`), falling back to any accessible brain.
3. For env-var callers with no `userId` — look up by name against
   `tenant.brain.findFirst` in this tenant DB, or fall back to the first
   org-type brain.

`canWrite(brain)` (`src/lib/mcp/tools.ts:280-282`) returns true only for
`owner` or `editor` roles. Write-path tools (`aju_create`, `aju_update`,
`aju_delete`) check this before mutating.

Multi-brain resolver `resolveBrainsForTool` (`tools.ts:153-252`) handles
arrays, `"all"`, and comma-separated strings for search-style tools —
all still scoped to the single tenant DB of the caller's org.

## Result shape

All tools return MCP `CallToolResult` objects with a single text content
block carrying JSON-serialized data (`textResult` at
`src/lib/mcp/tools.ts:286-292`). Error results set `isError: true`
(`errorResult` at `src/lib/mcp/tools.ts:294-299`).

**Why stringified JSON:** MCP content blocks are typed `text | image | resource`.
Structured tool output could go in a `resource`, but client support is
uneven. A JSON-in-text block always works.

## The tools

### `aju_search`

Full-text search over `vault_documents.search_vector` (a `tsvector` column
backed by Postgres' `websearch_to_tsquery`).

| Param | Type | Notes |
|---|---|---|
| `query` | string | Required. `websearch_to_tsquery`-friendly syntax. |
| `brain` | string \| string[] \| `"all"`? | Brain(s) to search. Single name, array, comma-separated string, or `"all"` for every accessible brain. Omit → default brain. |
| `section` | string? | Filter by top-level section / directory prefix. |
| `limit` | number? | Default 20, clamped to 100. |

Implementation in `src/lib/mcp/tools.ts:310-395`. Runs inside
`withTenant({ organizationId, userId })` and uses raw SQL against `tx`
with `brain_id = ANY($2::text[])` (so the same query handles one or
many brains), `ts_rank` ordering, and `ts_headline` for snippets. Each
result includes a `brain` field so callers can see which brain each hit
came from.

Multi-brain is **within one org** — the tenant DB is the boundary, so
"all" means every accessible brain in the caller's org, not across
orgs. For cross-org search the client holds two MCP connections (two
keys) and queries each separately.

Example multi-brain call → response:

```json
{
  "brains": ["personal", "work"],
  "query": "vector search",
  "count": 2,
  "results": [
    {
      "brain": "personal",
      "path": "topics/vector-search.md",
      "title": "Vector search",
      "section": "topics",
      "score": 0.091,
      "snippet": "HNSW index with <<voyage>>-<<4>>-large <<embeddings>>…"
    },
    {
      "brain": "work",
      "path": "eng/retrieval.md",
      "title": "Retrieval stack",
      "section": "eng",
      "score": 0.072,
      "snippet": "we fan out to <<vector>> and FTS…"
    }
  ]
}
```

### `aju_semantic_search`

Embedding-backed search. Two modes:

- `mode: "vector"` — pure cosine similarity over `vault_documents.embedding`
  (`src/lib/mcp/tools.ts:430-463`).
- `mode: "hybrid"` (default) — Reciprocal Rank Fusion of a vector top-100
  and an FTS top-100 with `k=60` (`src/lib/mcp/tools.ts:465-535`).

Same tenant-wrapped pattern: the `$queryRawUnsafe` runs against the
transaction client `tx` obtained from `withTenant(...)`, so RLS by
`brain_id` is already enforced at the DB layer.

| Param | Type | Notes |
|---|---|---|
| `query` | string | Required, natural language. |
| `brain` | string \| string[] \| `"all"`? | Same shape as `aju_search`. |
| `mode` | `"hybrid"` \| `"vector"` | Default `"hybrid"`. |
| `limit` | number? | Default 20, clamped to 100. |

The query is embedded via `generateEmbedding(query, "query")`
(`src/lib/embeddings.ts`) and converted to a pgvector literal via
`toVectorLiteral`.

**Why RRF rather than weighted cosine + ts_rank:** the two scales aren't
comparable. Cosine similarity is `[0, 1]`-ish; `ts_rank` is unbounded.
RRF's rank-only formulation (`1 / (k + rank)`) sidesteps the normalization
headache entirely and has shown up as the strongest zero-tuning baseline
in the hybrid-retrieval literature.

**Cross-brain ranking:** when `brain` is a list, the vector and FTS CTEs
filter with `brain_id = ANY($3::text[])` and pull their top 100 candidates
from the combined candidate pool. The RRF fusion happens in one pass over
that unioned set, so the output is a single ranked list with scores that
are directly comparable across brains — the LLM does not need to merge
per-brain results itself. Each row carries a `brain` field for
attribution.

### `vault-deep-search`

GraphRAG deep search: hybrid (FTS + vector) seed retrieval followed by
1-hop (or 2-hop) graph expansion across document wikilinks, then
re-ranked by a blend of relevance, graph proximity, and link-density.
Best for multi-document questions where context is spread across linked
notes (e.g. "what do we know about X and how does it connect to Y").
Returns seeds plus graph neighbors, each tagged with `source` (`"seed"`
or `"graph"`) and a hop distance.

| Param | Type | Notes |
|---|---|---|
| `q` | string | Required. Natural language works best. |
| `section` | string? | Filter seed documents by vault section. |
| `type` | string? | Filter seed documents by document type. |
| `seeds` | number? | Seed docs to expand from. Default 5, max 20. |
| `limit` | number? | Results after re-ranking. Default 20, max 100. |
| `depth` | number? | Graph expansion depth: `1` (direct neighbors, default) or `2` (friends-of-friends). |

Implementation: `mcp/aju-server.ts:512-552`, which proxies to the
`/api/vault/deep-search` REST route. Named `vault-deep-search`
(kebab-case) rather than `aju_deep_search` because it currently ships via
the stdio bridge surface; the remote endpoint inherits the same tool when
the bridge is mounted. The description above is verbatim the text the MCP
host sees in its tool catalog.

**Why a separate tool rather than a flag on `aju_semantic_search`:** the
return shape is fundamentally different. Semantic search returns a flat
ranked list; deep-search returns seeds + graph neighbors + an edge list,
and the blended score is not comparable to RRF. Folding it into the same
tool would force the caller to branch on the response shape. A distinct
tool keeps the output contract obvious.

**When the LLM should reach for it:** escalation from `aju_search` +
`aju_semantic_search`. If the two hybrid surfaces return single-doc
matches but the user's question is clearly multi-hop ("how do these
connect?", "what's the whole picture?"), deep-search is the right next
call. It's slower and more expensive — don't default to it.

### `aju_read`

Read a full document by path.

| Param | Type | Notes |
|---|---|---|
| `path` | string | Required, vault-relative path. |
| `brain` | string? | |

Returns everything persisted: `path`, `title`, `section`, `directory`,
`docType`, `docStatus`, `tags`, `frontmatter`, `wikilinks`, `wordCount`,
`updatedAt`, `content`. `src/lib/mcp/tools.ts:538-591`. Runs
`tx.vaultDocument.findFirst({ where: { brainId, path } })` inside the
tenant transaction.

### `aju_browse`

List documents under a directory prefix. Metadata only — no content.

| Param | Type | Notes |
|---|---|---|
| `directory` | string? | Omit to list the whole brain. |
| `brain` | string? | |

Capped at 500 rows via `take: 500`. `src/lib/mcp/tools.ts:594-651`.
`tx.vaultDocument.findMany(...)` inside the tenant transaction. Purpose
is LLM exploration — "what's in `journal/`?" — not enumeration. Callers
that need to walk the whole brain should use the CLI's `aju export`.

### `aju_create`

Create a new document.

| Param | Type | Notes |
|---|---|---|
| `path` | string | Should end in `.md`. |
| `content` | string | Full markdown including optional frontmatter. |
| `brain` | string? | |

Flow (`src/lib/mcp/tools.ts:654-740`):

1. `withTenant({ organizationId, userId })` opens a transaction against
   the org's tenant DB and captures both the `tenant` client and `tx`.
2. Check `canWrite(brain)`; reject if viewer.
3. Check path uniqueness (`tx.vaultDocument.findFirst` by `brainId + path`).
4. `parseDocument(content, path)` (`src/lib/vault-parse.ts`) extracts
   frontmatter, title, tags, wikilinks, content hash.
5. `tx.vaultDocument.create(...)` + `tx.vaultChangeLog.create(...)` inside
   the transaction, tagged `source: "mcp"`, `changedBy: ctx.identity`.
6. After commit, fire-and-forget `rebuildLinks(tenant, brainId)` and
   `updateDocumentEmbedding(tenant, docId)` — both take the tenant client
   as their first argument so they know which org's DB to write back
   into.

The background tasks are detached with `.catch(...)` so the tool call
returns immediately. Link resolution and embedding generation catch up
asynchronously.

### `aju_update`

Replace the full content of an existing document.

| Param | Type | Notes |
|---|---|---|
| `path` | string | Must exist. |
| `content` | string | Full replacement. |
| `brain` | string? | |

Same parse + index pipeline as `aju_create`, but against an `update`
change-log operation. `src/lib/mcp/tools.ts:743-828`. Also wrapped in
`withTenant` with a post-commit fire-and-forget rebuild/embed. There is
no partial update — the LLM must read, mutate, and write back.

**Why no partial update:** diff-based APIs look friendly but introduce
merge semantics and a whole category of "I thought I was editing line 5"
bugs. A full replace is boring and correct. The Claude Code skill
explicitly prescribes this pattern (`client/cli/cmd/skill_body.md:94-105`).

### `aju_delete`

Delete a document.

| Param | Type | Notes |
|---|---|---|
| `path` | string | Must exist. |
| `brain` | string? | |

Logs a `delete` entry in `vault_change_log` *before* removing the row
(`src/lib/mcp/tools.ts:831-886`), all inside the tenant transaction,
then fires `rebuildLinks(tenant, brainId)` post-commit to clear
dangling edges.

### `aju_backlinks`

All documents that link TO a target. Reads `document_links` where
`targetId = doc.id`, via `tx.documentLink.findMany(...)` inside the
tenant transaction.

```json
{
  "brain": "personal",
  "path": "topics/vector-search.md",
  "count": 3,
  "backlinks": [
    { "linkText": "vector search", "path": "journal/2026-04-10.md", "title": "…" }
  ]
}
```

`src/lib/mcp/tools.ts:889-942`.

### `aju_related`

Union of outgoing links, incoming links (backlinks), and tag-neighbors.
Deduplicated by path, ordered by source (outgoing first, incoming second,
tag-neighbors last).

| Param | Type | Notes |
|---|---|---|
| `path` | string | |
| `brain` | string? | |
| `limit` | number? | Default 50, clamped to 200. |

Tag-neighbors are computed with a raw SQL query that intersects the
target's `tags` array with every other document's
(`src/lib/mcp/tools.ts:995-1011`). Outgoing and incoming links go
through `tx.documentLink.findMany`. Each result is labeled
`relationship: "outgoing_link" | "incoming_link" | "tag_neighbor (N shared)"`.

### `aju_brains_list`

Enumerate accessible brains. No parameters.

```json
{
  "count": 2,
  "brains": [
    { "name": "personal", "type": "personal", "role": "owner", "documentCount": 312 },
    { "name": "work", "type": "org", "role": "editor", "documentCount": 41 }
  ]
}
```

`src/lib/mcp/tools.ts:1070-1118`. Enumerates `tenant.brainAccess` (or
`tenant.brain` for legacy env-var callers) inside the tenant
transaction — only brains in the caller's pinned org are visible. The
`name` field is what callers pass to other tools' `brain` argument.

## Error handling

Every tool wraps its body in `try / catch` and converts exceptions to
`errorResult(String(err.message))`. Typical failure modes:

- `Brain not found or access denied: <name>` — `resolveBrainForTool` failed
  the `BrainAccess` check.
- `No brain configured for this user` — user has zero brains; the dashboard
  normally creates one on signup, but race conditions happen.
- `Document not found: <path>` — `aju_read` / `aju_update` / `aju_delete`
  couldn't find the path.
- `Document already exists: <path>` — `aju_create` collision.
- `Write access denied for brain: <name>` — caller has viewer role.

Network- or Prisma-level errors (DB unreachable, timeout) surface as the
raw error message. Those bubble up to the transport layer too; the
stateless request simply fails with the JSON-RPC `-32603` envelope.

## What's not exposed

The legacy `mcp/aju-server.ts` stdio server exposes file-upload tools
(`vault-upload-file`, `vault-list-files`, `vault-read-file`,
`vault-delete-file`) and admin tools (`vault-rebuild-links`,
`vault-backfill-embeddings`). The remote `aju_*` surface deliberately
omits these:

- **File upload** over MCP means base64-encoding a PDF inside a JSON-RPC
  message. That's technically possible but wasteful; the CLI handles
  uploads over multipart HTTP (`aju files upload`).
- **Admin cron tools** are triggered automatically after every write and
  should not need to be invoked by an agent. They remain callable via the
  `/api/cron/*` routes with an admin-scoped key.

The trimmed surface is intentional: fewer tools means cleaner LLM
tool-selection behavior.
