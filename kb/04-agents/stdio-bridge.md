---
title: The stdio bridge (retired)
description: client/mcp/aju-server.ts — the legacy stdio MCP transport, what it did, and when you'd still want to spawn it.
order: 70
---

# The stdio bridge (retired)

Before the remote `/api/mcp` endpoint existed, aju shipped a local stdio
MCP server at `client/mcp/aju-server.ts`. Clients that couldn't speak Streamable
HTTP spawned it as a subprocess and talked to it over stdin/stdout using
the MCP stdio transport.

The remote endpoint obsoletes this for every supported client today, and
`aju mcp serve` has been stubbed out to point users at the hosted URL
`https://mcp.aju.sh/mcp` (`client/cli/cmd/stub.go:19-29`). The stdio server
file is still present for:

1. Anyone running aju self-hosted who wants a local no-network path.
2. Legacy MCP hosts without Streamable HTTP support.

Worth noting: the stdio bridge predates the one-DB-per-org split. It
proxies through `/api/vault/*` REST endpoints, which today route to the
tenant DB pinned to the bearer token's `organizationId` just like the
native `/api/mcp` handler does. So the stdio path still works; it's
just a slower, more operator-heavy way to reach the same per-org
tenant database.

## What it does

`client/mcp/aju-server.ts` is a Node script that:

1. Reads `MCP_BASE_URL`, `MCP_API_KEY`, and optional `MCP_BRAIN` from the
   environment (`client/mcp/aju-server.ts:8-13`).
2. Opens an `McpServer` over `StdioServerTransport`
   (`client/mcp/aju-server.ts:515-517`).
3. Forwards every tool call to the aju REST API over HTTP with bearer
   auth (`fetchGet` / `fetchPost` at `client/mcp/aju-server.ts:15-150`).

So it's a proxy — the tools run against the same `/api/vault/*` endpoints
that the CLI hits. The difference from the remote `/api/mcp` endpoint is
that the proxy shuffles JSON-RPC messages over stdin/stdout to the client,
not Streamable HTTP.

## Tool surface

The stdio server registers a superset of what the remote endpoint exposes,
because it was built before the surface was pared down. All tools are
named `vault-*` (note: not `aju_*`, and kebab-case rather than
snake_case):

| Stdio tool | Remote equivalent | Notes |
|---|---|---|
| `vault-search` | `aju_search` | Same FTS. |
| `vault-semantic-search` | `aju_semantic_search` | |
| `vault-read` | `aju_read` | |
| `vault-browse` | `aju_browse` | |
| `vault-create` | `aju_create` | |
| `vault-update` | `aju_update` | |
| `vault-delete` | `aju_delete` | |
| `vault-backlinks` | `aju_backlinks` | |
| `vault-related` | `aju_related` | |
| `vault-graph` | — | No remote equivalent. `mode: stats \| neighbors`. |
| `vault-upload-file` | — | Base64 uploads. |
| `vault-list-files` | — | |
| `vault-read-file` | — | `mode: metadata \| url \| content`. |
| `vault-delete-file` | — | |
| `vault-rebuild-links` | — | Admin: triggers `/api/cron/rebuild-links`. |
| `vault-backfill-embeddings` | — | Admin: triggers `/api/cron/backfill-embeddings`. |

The remote surface trimmed the four file tools and the two admin tools on
purpose — see [mcp-tools.md](./mcp-tools.md#whats-not-exposed).

**Caution:** the tool-name mismatch is intentional. `vault-*` maps to the
REST proxy, `aju_*` maps to the direct-Prisma remote surface. If you
configure both an MCP stdio server AND the remote endpoint in the same
host, the LLM sees both sets of tools.

## When to use it

Legacy fallback config
(`src/app/doc/mcp/page.tsx:43-51`):

```json
{
  "mcpServers": {
    "aju": {
      "command": "aju",
      "args": ["mcp", "serve"],
      "env": { "AJU_API_KEY": "aju_live_<your key>" }
    }
  }
}
```

For this to work today you'd need to:

1. Revert the stub at `client/cli/cmd/stub.go` to actually boot
   `client/mcp/aju-server.ts` (or run the Node script directly).
2. Wire `AJU_API_KEY` → `MCP_API_KEY` and `MCP_BASE_URL=https://aju.sh` in
   the env.

The commit that retired `aju mcp serve` left the snippet in the docs as a
reference for operators running a custom fork. The **public path is the
remote endpoint** — don't spend time on the stdio bridge unless you have a
specific reason.

## Why it was retired

Three reasons, all listed in the stub's own comment
(`client/cli/cmd/stub.go:14-18`):

1. **Redundancy.** Every supported client speaks Streamable HTTP now.
   Maintaining a second transport means two code paths to test.
2. **Operator burden.** The stdio path requires the user to have a Node
   runtime available, install the MCP server npm dependency, and set
   `MCP_BASE_URL` + `MCP_API_KEY` env vars — all of which the remote
   endpoint eliminates.
3. **Drift.** `client/mcp/aju-server.ts` proxies through REST, which means every
   new feature on `/api/mcp` (brain scoping via query param, trimmed tool
   surface, `aju_*` naming) has to be replicated in the stdio file to
   match. Easier to have one authoritative surface.

## Direct vs proxied tool execution

Worth noting — even though both tool surfaces look similar, they reach
the database differently:

- **Remote `/api/mcp`** (`src/lib/mcp/tools.ts`) — each tool handler
  issues Prisma queries directly against the database. One process hop.
- **Stdio `client/mcp/aju-server.ts`** (`client/mcp/aju-server.ts`) — each tool handler
  HTTP-calls `/api/vault/*` on the hosted app, which in turn runs the
  same Prisma queries. Two process hops and a JSON round-trip.

The stdio proxy has a latency penalty and inherits all the auth behavior
of the REST endpoints. The remote endpoint skips the REST hop entirely
and binds the auth context once in `buildServer(...)`.

## If you fork and want to keep stdio

The file is otherwise complete. Edit `client/mcp/aju-server.ts` directly — it's
a single TypeScript file and the tool surface is trivial to extend. The
shape of each registration:

```ts
server.tool(
  "vault-X",
  "Description",
  { /* zod schema */ },
  async (args) => {
    const text = await fetchGet("X", args);
    return { content: [{ type: "text" as const, text }] };
  },
);
```

Nothing clever — and that's the point. The bridge is a thin proxy, not a
second implementation.
