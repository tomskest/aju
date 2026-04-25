---
title: The remote MCP endpoint
description: /api/mcp — Streamable HTTP transport, bearer auth, optional brain scoping, stateless per-request lifecycle.
order: 20
---

# The remote MCP endpoint

aju exposes exactly one MCP endpoint, served at the public URL
`https://mcp.aju.sh/mcp` (internally `POST /api/mcp`, plus `GET` for SSE
notifications and `DELETE` for session termination, per the spec). The
`mcp.aju.sh` subdomain is a rewrite to the app's `/api/mcp` route; the
public URL stays stable regardless of deployment host. Override with
`NEXT_PUBLIC_MCP_URL` in self-hosted or staging setups.

The endpoint is backed by a single Next.js route handler —
`src/app/api/mcp/route.ts` — and uses the
`@modelcontextprotocol/sdk` Streamable HTTP transport in stateless mode.

## One URL, many orgs

The URL is identical no matter which organization you want to talk to.
The **organization** is picked entirely by which bearer token you
authenticate with: each `aju_live_*` key is pinned to one org via
`ApiKey.organizationId` (control DB), and the server routes every
request to that org's tenant Postgres via `tenantDbFor(orgId)` from
`src/lib/db.ts`. Swap tokens → swap orgs. There is no single cross-org
database to fall back to: if the pinned org can't be resolved, the
request fails with `400 No organization context for this MCP request`.

Multi-org operators point the client at `https://mcp.aju.sh/mcp` N
times, once per (client entry × token). See
[clients.md](./clients.md#multi-org-configuration) for shape examples.

## Wire-up at a glance

```
POST   /api/mcp   — JSON-RPC messages (initialize, tools/list, tools/call, …)
GET    /api/mcp   — SSE stream for server-initiated notifications
DELETE /api/mcp   — terminate session
```

All three verbs are handled by the same function:

```ts
export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }
export async function DELETE(req: NextRequest) { return handle(req); }
```

`src/app/api/mcp/route.ts:110-120`.

## Transport

The route uses `WebStandardStreamableHTTPServerTransport` from
`@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`
(`src/app/api/mcp/route.ts:21`). That transport is the Web Standards
equivalent of the Node `http.ServerResponse` transport — it consumes a
`Request` object and returns a `Response`, which is exactly what Next.js
route handlers expect.

The transport is constructed with:

```ts
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,   // stateless: no session id
  enableJsonResponse: true,
});
```

`src/app/api/mcp/route.ts:70-74`.

### Why stateless

Passing `sessionIdGenerator: undefined` tells the transport never to mint a
session id — every request is self-contained. The route comment spells out
the tradeoff:

> Each request gets a fresh server + transport pair (stateless mode) so we
> don't have to plumb any session storage here — the MCP spec allows this
> and Claude-family clients tolerate it.

In practice, statefulness would mean storing `McpServer` instances across
requests and re-attaching them to new HTTP transports when the next
`POST /api/mcp` arrives. On Vercel-style serverless runtimes that is a
losing fight — the function process dies between invocations. Stateless
mode trades a tiny setup cost per request (build server, register tools,
bind auth context) for zero session plumbing.

`enableJsonResponse: true` lets the transport return a plain JSON response
for single request/response pairs instead of forcing SSE. The SDK still
switches to SSE when the server wants to stream (e.g. tool progress), but
most `tools/call` round-trips come back as one JSON body.

## Authentication

The same bearer scheme used for `/api/vault/*` routes. The route delegates
to `authenticate(req)` from `src/lib/auth.ts:144`:

```ts
const auth = await authenticate(req);
if (isAuthError(auth)) return auth;
```

`src/app/api/mcp/route.ts:64-65`.

`authenticate` resolves the `Authorization: Bearer …` header in this order:

1. Token starts with `aju_live_` or `aju_test_` → database-backed API key.
   The first 12 characters are the unhashed prefix; the full token is
   verified against the stored hash via `verifyApiKey` (`src/lib/auth.ts:99-142`).
   On success we get back `userId`, `email`, `role`, `apiKeyId`, and the
   pinned `organizationId` for the key. Newly-minted keys always carry a
   pinned org (`ApiKey.organizationId`); for legacy unpinned keys the
   route handler falls back to the user's `personalOrgId`
   (`src/app/api/mcp/route.ts:114-121`).
2. Token matches an `API_KEY` / `API_KEY_*` env var → legacy env-var
   identity (`src/lib/auth.ts:156-159`). Used by single-tenant deployments
   and the CI test harness.

Anything else returns `401 Unauthorized`.

If neither a pinned org nor a personal-org fallback is available, the
route responds with `400` — there is no "cross-org" or "default"
database to use.

### Why bearer, not OAuth

aju's auth story is: *humans use a session cookie, machines use a bearer
token.* The MCP spec allows arbitrary auth flows, but every MCP host in
circulation today ships with a "paste your token here" field. OAuth device
flow lives a layer up (the CLI uses it to *mint* a key), but the MCP
endpoint itself only sees the resulting token.

## Brain scoping: `?brain=<name>`

Optional. If present, pins every tool call in this request scope to a
named brain **within the authenticated key's org**, so the LLM doesn't
have to pass `brain: "foo"` on every call:

```ts
const defaultBrain = req.nextUrl.searchParams.get("brain") || undefined;
```

`src/app/api/mcp/route.ts:107-108`.

The value flows into the tool context along with the resolved org:

```ts
const server = buildServer({
  userId: auth.userId,
  organizationId,       // pinned by ApiKey, or personalOrgId fallback
  identity: auth.identity,
  defaultBrain,
});
```

`src/app/api/mcp/route.ts:135-140`.

Inside each tool, `resolveBrainForTool(tx, ctx, explicitBrain)` runs
against the tenant DB transaction (see
[mcp-tools.md](./mcp-tools.md#brain-resolution)) and picks:

1. `explicitBrain` if the tool call passed one, else
2. `ctx.defaultBrain` (this query param), else
3. the user's first personal brain in this tenant DB (stable ordering by
   `createdAt`).

Cross-org brain selection is not possible in a single connection: the
tenant DB boundary IS the org boundary, and the `?brain=` name is looked
up inside the tenant DB picked by the bearer token. A client that needs
both orgs registers two MCP server entries, each with its own key.

### Why a query param instead of a header

A header (e.g. `X-Aju-Brain`) would work but isn't configurable in most MCP
clients — they let you set `url` and sometimes `headers`, but not all
clients expose the latter. A query param is always configurable because
it's part of the URL.

## Request lifecycle

Per request:

```ts
async function handle(req: NextRequest): Promise<Response> {
  const auth = await authenticate(req);
  if (isAuthError(auth)) return withWwwAuthenticate(req, auth);

  const defaultBrain = req.nextUrl.searchParams.get("brain") || undefined;

  // Resolve the organization whose tenant DB this request routes to.
  let organizationId = auth.organizationId ?? null;
  if (!organizationId && auth.userId) {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { personalOrgId: true },
    });
    organizationId = user?.personalOrgId ?? null;
  }
  if (!organizationId) {
    return NextResponse.json(
      { error: "No organization context for this MCP request" },
      { status: 400 },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const server = buildServer({
    userId: auth.userId,
    organizationId,
    identity: auth.identity,
    defaultBrain,
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(req);
  } catch (err) {
    console.error("[mcp] transport error:", err);
    return NextResponse.json(/* JSON-RPC error envelope */, { status: 500 });
  } finally {
    server.close().catch(() => {});
  }
}
```

`src/app/api/mcp/route.ts:85-167`.

Notably: every request builds a fresh `McpServer` and `registerAjuTools()`
against it. That's ten tool-registration calls on the hot path. Fast because
it's in-process object construction, but it explains why the route is
flagged `export const dynamic = "force-dynamic"` — Next.js should never try
to cache or pre-render it.

The `organizationId` resolved here flows into every tool handler's
`McpToolContext`, and each tool wraps its work in
`withTenant({ organizationId, userId })` (see `src/lib/tenant-context.ts`).
That helper opens a transaction on the org's tenant client, computes the
caller's accessible `brainIds`, and pins them via
`SET LOCAL app.current_brain_ids = '…'` so the tenant DB's RLS policies
can filter correctly.

## Error envelope

JSON-RPC errors come out of the SDK as `{ jsonrpc, error: { code, message, data }, id }`.
Transport-level failures (exceptions thrown while handling the request) are
wrapped manually at `src/app/api/mcp/route.ts:89-100`:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Internal server error",
    "data": "…error.message…"
  },
  "id": null
}
```

Tool-level errors are returned as `isError: true` text responses — the LLM
sees a structured error payload and can react. See
[mcp-tools.md](./mcp-tools.md#error-handling) for the tool-level pattern.

## Capabilities advertised

```ts
new McpServer(
  { name: "aju", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions: "aju is the user's personal memory / knowledge base …",
  },
);
```

`src/app/api/mcp/route.ts:43-55`.

Only `tools` is declared. No resources, no prompts, no sampling. That's
intentional — the full surface area fits into the tool metaphor.

The `instructions` string is exposed to the client as part of the
`initialize` response. Well-behaved hosts surface it to the LLM as system
priming, which gives the model a nudge toward calling aju tools when the
user says "remember" or "recall".
