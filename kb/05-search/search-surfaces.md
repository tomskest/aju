---
title: Search surfaces
description: Every caller of the search API — CLI, MCP tools, and the (not-yet) web UI.
order: 70
---

# Search surfaces

Three consumers for the search API:

1. The `aju` Go CLI.
2. The remote `/api/mcp` endpoint at `https://mcp.aju.sh/mcp`, which
   registers the `aju_*` tool surface directly against the caller's
   tenant DB. The legacy stdio MCP server at `mcp/aju-server.ts` is
   retired.
3. The Next.js web app — **has no search UI today**.

All three authenticate the same way (bearer `aju_live_*` key) and the
bearer picks the organization — each request is routed to that org's
per-tenant Postgres via `tenantDbFor(orgId)`. The CLI is a thin HTTP
adapter over `/api/vault/*`; the MCP endpoint calls Prisma against the
tenant client directly (no REST hop); no search logic lives outside
`src/app/api/vault/` and `src/lib/mcp/tools.ts`.

## HTTP endpoints, recap

| Route | Method | Purpose |
|---|---|---|
| `/api/vault/search` | GET | Pure FTS. Docs + files UNIONed. |
| `/api/vault/semantic-search` | GET | `mode=hybrid` (RRF, default) or `mode=vector`. |
| `/api/vault/deep-search` | GET | GraphRAG: hybrid seeds + 1–2 hop graph expansion. |
| `/api/vault/backlinks` | GET | Incoming links for a path. |
| `/api/vault/related` | GET | Outgoing + incoming + tag neighbours. |
| `/api/vault/graph` | GET | `mode=stats` or `mode=neighbors`. |
| `/api/cron/backfill-embeddings` | POST | Fill `embedding IS NULL` rows. |
| `/api/cron/rebuild-links` | POST | Full-rebuild `document_links`. |

Auth: every route calls `authenticate(req)` (`src/lib/auth.ts`), which
accepts either a session cookie (web UI) or a `Bearer aju_live_*` token
from the API-key table. The authenticated identity carries a pinned
`organizationId` (or falls back to `personalOrgId`), which routes the
request to the right tenant DB via `tenantDbFor(orgId)`. Brain is
resolved by name inside that tenant DB via the `brain=` query param or
falls back to the caller's default. Each route typically wraps its body
in `withTenant({ organizationId, userId })` from
`src/lib/tenant-context.ts` so every query runs inside a brain-scoped
transaction.

### Multi-brain search

`/api/vault/search` and `/api/vault/semantic-search` accept several
shapes on the `brain` query param:

- `brain=foo` — single brain.
- `brain=foo&brain=bar` — exactly those brains.
- `brain=foo,bar` — same, comma-separated inside one value.
- `brain=all` — every brain the caller can access.

Access is checked per-brain against `BrainAccess` inside the caller's
tenant DB; a 403 is returned with the list of unauthorised names when
any requested brain is not accessible. The fusion is native: in hybrid
mode, the vector and FTS CTEs both filter with
`brain_id = ANY($::text[])` and RRF runs once on the union, so scores
are comparable across brains (see `hybrid-rrf.md`). Each result row
carries a `brain` field so callers can attribute the hit. Mutating
routes stay single-brain because a document always lives in exactly
one brain.

**Scope is within one org.** Multi-brain `?brain=all` means "every
brain in the authenticated key's organization" — it fans out across
every brain in the **one** tenant DB the request routes to. There is no
single call that spans organizations; cross-org access means holding a
second API key (for the other org) and issuing a second request.

## The CLI

`client/cli` is a Go binary that wraps the same HTTP endpoints.
Dispatch table: `client/cli/main.go:38`.

### `aju search <query>`

`client/cli/cmd/search.go:41`. GET `/api/vault/search`.

```
aju search "NDC carriers" --limit 10
aju search "hamburg" --brain work --json
aju search "incident" --brain personal,work      # two brains, fused ranks
aju search "retrieval" --brain all               # every accessible brain
```

`--brain` accepts a single name, a comma-separated list, or `all`. When
the response mixes brains, the CLI prefixes each snippet with
`[brain-name]` so the source is obvious; with a single brain the
output stays unchanged. Raw JSON via `--json` always carries `brain`
per row regardless.

### `aju semantic <query>`

`client/cli/cmd/search.go:77`. GET `/api/vault/semantic-search`.

```
aju semantic "crew scheduling bottlenecks" --mode hybrid
aju semantic "embeddings at scale"          --mode vector
aju semantic "NDC parity"                   --brain personal,work
aju semantic "decisions about pricing"      --brain all
```

`--mode` defaults to `hybrid`. `vector` skips the FTS CTE. Same
multi-brain behaviour as `aju search` — in hybrid mode the server-side
RRF fuses candidates from every requested brain in a single pass.

### `aju deep-search <query>`

`client/cli/cmd/search.go:113`. GET `/api/vault/deep-search`. GraphRAG
retrieval: seed the pool with a hybrid FTS+vector RRF search, then walk
the wikilink graph 1–2 hops from those seeds and re-rank by a blend of
vector similarity, graph proximity, and how many seeds reach each
neighbour.

```
aju deep-search "how does our NDC strategy relate to airline partnerships"
aju deep-search "hamburg cluster" --seeds 10 --depth 2 --limit 50
```

Flags: `--seeds <n>` (default 5, max 20) sets how many hybrid seeds
feed the graph walk; `--depth 1|2` (default 1) sets the hop radius;
`--limit`, `--brain`, `--section`, `--type`, and `--json` behave the
same as on `aju semantic`. Use when a question spans multiple linked
notes; stick to `aju search` or `aju semantic` for single-document
lookups — deep-search is an escalation, not a default, and costs an
extra SQL roundtrip for the graph expansion.

See [hybrid-rrf.md](./hybrid-rrf.md#where-hybrid-rrf-plugs-into-graphrag)
for how the seed stage works and
[knowledge-graph.md](./knowledge-graph.md#deep-search-graphrag) for the
expansion and scoring blend.

### `aju backlinks <path>`

`client/cli/cmd/graph.go:14`. GET `/api/vault/backlinks`. One row per
incoming edge, printed as `path\ttitle`.

### `aju related <path>`

`client/cli/cmd/graph.go:62`. GET `/api/vault/related`. Prints
`path\trelationship\ttitle` where relationship is `outgoing_link`,
`incoming_link`, or `tag_neighbor (N shared)`.

### `aju graph [--mode stats|neighbors] [--path <p>]`

`client/cli/cmd/graph.go:109`. GET `/api/vault/graph`.

- `--mode stats` (default) prints totals and the top-20 most-linked docs.
- `--mode neighbors --path foo/bar.md` prints the 2-hop ego-network.

### `aju rebuild-links`

POST `/api/cron/rebuild-links`. Admin operation; the auto-rebuild after
writes is the usual path.

### `aju changes [--since <ISO>]`

GET `/api/vault/changes`. Not search per se — reads from
`VaultChangeLog` — but it's the read side of "what was touched
recently" and pairs well with search.

### What the CLI does **not** expose

No `aju recall`. The task description mentioned it as a potential
command name; it is not implemented — `aju search`, `aju semantic`,
and `aju deep-search` together cover that shape.

## The remote MCP endpoint

`src/lib/mcp/tools.ts` registers the `aju_*` tool surface against
`src/app/api/mcp/route.ts`, served publicly at
`https://mcp.aju.sh/mcp`. Search-relevant tools:

| MCP tool | What it runs |
|---|---|
| `aju_search` | Raw SQL FTS against `vault_documents` inside a tenant transaction. |
| `aju_semantic_search` | Pure-vector or RRF hybrid against `vault_documents.embedding`. |
| `aju_backlinks` | `tx.documentLink.findMany({ where: { targetId } })`. |
| `aju_related` | Outgoing + incoming links + raw-SQL tag neighbours. |
| `aju_brains_list` | `tx.brainAccess.findMany({ where: { userId } })`. |

(No `aju_graph`, no `aju_deep_search`, no admin/backfill tools on the
remote surface — deliberately trimmed. See
[../04-agents/mcp-tools.md](../04-agents/mcp-tools.md#whats-not-exposed).)

Every handler runs inside
`withTenant({ organizationId, userId })`:

```ts
return await withTenant(
  { organizationId, userId: ctx.userId },
  async ({ tx }) => {
    const brains = await resolveBrainsForTool(tx, ctx, brain);
    // …Prisma / raw SQL queries against `tx`…
  },
);
```

— which both routes the query to the right tenant DB
(`tenantDbFor(organizationId)`) and opens a transaction with
`SET LOCAL app.current_brain_ids = '…'` so RLS gates match the caller's
`BrainAccess` rows. The legacy stdio bridge at `mcp/aju-server.ts` is
retired; the native `/api/mcp` route binds auth + org context once per
request instead of proxying through the REST layer.

### Connecting

Any MCP-capable client points at `https://mcp.aju.sh/mcp` with a
`Bearer aju_live_*` token; see the per-client config shapes at
[../04-agents/clients.md](../04-agents/clients.md).

## The web UI

The Next.js app under `src/app/app/` is currently focused on brain
management, org settings, and agent admin. **No search box.** The
reader of this KB will find:

- `src/app/app/page.tsx` — landing / dashboard.
- `src/app/app/brains/` — list and detail views for brains.
- `src/app/app/orgs/` — org settings and memberships.
- `src/app/app/agents/` — agent creation and listing.

Grepping for `vault/search` or `vault/semantic` in `src/app/app`
returns nothing. The intentional stance today: search is an **agent**
surface, not a human one. Humans drive the CLI (for quick queries) or
let an LLM-backed client (Claude, Cursor, anything speaking MCP) do
the asking on their behalf.

A web search surface is on the roadmap. When it lands it will call
the same `/api/vault/*-search` routes — no server-side duplication
needed.

## Authentication summary

- **CLI**: `aju login [--profile <name>]` runs the device-code flow,
  receives a long-lived API key pinned to one org, stores it in the
  named profile in `~/.aju/config.json`, and sends it as
  `Authorization: Bearer …` on every request.
- **MCP**: the client config embeds a bearer token directly (one entry
  per org); no env-var env_MCP_API_KEY dance required for the native
  endpoint.
- **Web UI** (when it acquires a search surface): Better-Auth session
  cookie plus an active-org cookie. `authenticate()` handles both
  identities with one entry point and resolves them to the same
  `(organizationId, userId)` pair the tenant helpers expect.

All three share the same per-org tenant DB routing, the same brain
scoping, the same RLS gating, and the same rate behaviour.
