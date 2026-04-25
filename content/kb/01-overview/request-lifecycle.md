---
title: Request lifecycle
description: How an HTTP request travels from client through Next.js into Postgres and S3, with every guard on the way.
order: 40
---

# Request lifecycle

This file traces a single `POST /api/vault/create` call from a CLI invocation to the moment the row lands in the tenant DB and an embedding is queued. The same shape applies to every other vault route — `search`, `semantic-search`, `document`, `update`, `delete`, `backlinks`, `graph`, and so on.

There is **no** `src/middleware.ts` in this repo. Every guard runs inside the route handler itself, using the helpers in `src/lib/`.

## The call chain

```
CLI (Go binary)
  │ Authorization: Bearer aju_live_…
  │ Body: { path, content, source }
  ▼
Next.js 15 route handler
  src/app/api/vault/create/route.ts
  │
  ├─▶ authenticate(req)          src/lib/auth.ts
  │     ├─ extract bearer token
  │     ├─ if prefix = aju_live_ → control-DB lookup by prefix, scrypt verify
  │     └─ else → constant-time env-var lookup (legacy)
  │         returns { userId, organizationId, apiKeyId, ... }
  │
  ├─▶ resolve organizationId     (auth.organizationId ?? user.personalOrgId)
  │
  ├─▶ withTenant({ organizationId, userId }, async ({ tenant, tx }) => ...)
  │     src/lib/tenant-context.ts
  │     ├─ tenantDbFor(orgId) → PrismaClientTenant for org_<cuid>
  │     ├─ query BrainAccess for this user → brainIds
  │     ├─ OPEN TRANSACTION on the tenant client
  │     └─ SET LOCAL app.current_brain_ids = '<cuid>,<cuid>,...'
  │
  │       (inside the transaction)
  │
  ├─▶ resolveBrain(tx, req, auth)   src/lib/brain.ts
  │     ├─ ?brain=<name> → BrainAccess lookup in the tenant DB
  │     ├─ else → user's personal brain, else first accessible
  │     └─ returns { brainId, accessRole }
  │
  ├─▶ canWrite(brain)            src/lib/brain.ts
  │     └─ 403 if role = viewer
  │
  ├─▶ parseDocument(content, path)   src/lib/vault-parse.ts
  │     └─ YAML frontmatter, tags, wikilinks, contentHash
  │
  ├─▶ tx.vaultDocument.create(...)
  ├─▶ tx.vaultChangeLog.create({ operation: "insert", ... })
  │       (both rows written atomically; RLS checked against brain_ids)
  │
  ├─▶ rebuildLinks(tenant, brainId)  (fire-and-forget)  src/lib/rebuild-links.ts
  └─▶ updateDocumentEmbedding(tenant, id)  (fire-and-forget)  src/lib/update-embedding.ts
        ├─ Voyage API → 1024-dim vector
        └─ UPDATE vault_documents SET embedding = $1::vector
```

## Step by step

### 1. The CLI sends the request

The Go CLI (`apps/cli/`) reads the device's saved API key, builds `Authorization: Bearer aju_live_…`, and POSTs JSON to `https://aju.sh/api/vault/create?brain=work`. Self-hosted users point `AJU_API_URL` at their deployment.

The API key is pinned to exactly one organization at mint time. That org determines which tenant database every request on this key routes to.

### 2. Next.js dispatches to the route handler

App Router matches `src/app/api/vault/create/route.ts` and invokes its exported `POST(req)`.

### 3. `authenticate(req)` resolves the caller

Source: `src/lib/auth.ts`.

```ts
export async function authenticate(req: NextRequest): Promise<AuthResult> {
  const token = extractToken(req);
  if (!token) return unauthorized();

  if (looksLikeDbKey(token)) {
    const dbAuth = await authenticateDbKey(token);
    if (dbAuth) return dbAuth;
    return unauthorized();
  }

  const identity = lookupEnvKey(token);
  if (identity) {
    return { identity, role: identity === "admin" ? "admin" : "member" };
  }
  return unauthorized();
}
```

Two paths:

- **DB-backed keys** (`aju_live_` or `aju_test_`): `prisma.apiKey.findUnique({ where: { prefix } })` against the control DB using the first 12 chars, then `verifyApiKey(token, row.hash)` (scrypt). On success we return `AuthSuccess` with `userId`, `email`, `apiKeyId`, and the key's pinned `organizationId`. A fire-and-forget `UPDATE` sets `last_used_at`.
- **Env-var keys** (legacy single-tenant): constant-time lookup in a map built from `API_KEY` and `API_KEY_*` env vars. This path is kept so the CLI works against a fresh control DB before the api_key table exists.

If neither matches, the function returns a pre-built `401` response. The route handler checks with `isAuthError` and short-circuits.

### 4. Resolve the organization and enter `withTenant`

Before touching any brain-level data, the handler resolves an `organizationId` — `auth.organizationId` (from the pinned API key) is preferred, falling back to `user.personalOrgId` for un-pinned legacy callers. No org = 400.

```ts
return withTenant(
  { organizationId, userId: auth.userId },
  async ({ tenant, tx }) => { /* ... */ },
);
```

`withTenant` (`src/lib/tenant-context.ts`):

1. Calls `tenantDbFor(organizationId)` — returns a cached `PrismaClientTenant` pointed at this org's encrypted DSN (`org_<cuid>`). Opens a fresh connection pool on first use; LRU reaps idle clients after 10 min.
2. Reads `BrainAccess` rows for this user from the tenant DB → a list of brain ids.
3. Opens a transaction on the tenant client and `SET LOCAL app.current_brain_ids = '<cuid>,<cuid>,...'`. RLS policies in `prisma/tenant/rls-policies.sql` read this variable on every row touch inside the transaction.

### 5. `resolveBrain(tx, req, auth)` picks which brain

Source: `src/lib/brain.ts`. Runs against the tenant transaction.

Resolution priority:

1. `?brain=<name>` query param → `BrainAccess` lookup for `(userId, brain.name)` in this tenant DB. 403 if no row.
2. No `?brain=` → the user's first accessible brain in this tenant DB, preferring `type=personal`.
3. No user context (legacy env-var auth) → first org brain, else any brain in the tenant DB.

Returns `{ brainId, brainName, brainType, accessRole }`.

### 6. Role check

`canWrite(brain)` returns false for `viewer`. The create route returns 403 before writing.

### 7. Parse the markdown

`parseDocument(content, path)` (in `src/lib/vault-parse.ts`) runs `gray-matter` on the frontmatter, extracts tags, scans the body for `[[wikilinks]]`, and computes a SHA-256 `contentHash`. It returns the structured fields the row needs.

### 8. Transactional write

```ts
const doc = await tx.vaultDocument.create({ data: { ... } });
await tx.vaultChangeLog.create({
  data: { brainId, documentId: doc.id, path, operation: "insert", source, changedBy: auth.identity },
});
```

Inside the same `withTenant` transaction — the document row and the audit entry go together, and RLS checks every INSERT against `app.current_brain_ids`. If either fails, both roll back.

### 9. Isolation layers at work

Two layers protect this write:

- **DB boundary (org isolation).** `tenantDbFor(organizationId)` returns a client whose DSN only grants access to `org_<cuid>`. A request carrying org A's credentials physically cannot touch org B's data — Postgres rejects the connection.
- **RLS on `brain_id` (intra-org isolation).** Inside one tenant DB, policies in `prisma/tenant/rls-policies.sql` gate every row on `brain_id = ANY(current_setting('app.current_brain_ids', true)::split)`. This catches the "forgot to filter on brainId" class of bug — a code path that queries `vault_documents` without a `where: { brainId }` still gets filtered to the caller's accessible brains. The session variable dies with the transaction, so concurrent requests on the same pooled connection cannot bleed state.

### 10. Side effects (fire-and-forget)

Two async jobs kick off without blocking the response, both bound to the tenant client:

```ts
rebuildLinks(tenant, brain.brainId).catch((err) => console.error("Link rebuild after create failed:", err));
updateDocumentEmbedding(tenant, doc.id).catch((err) => console.error("Embedding after create failed:", err));
```

- **`rebuildLinks(tenant, brainId)`** re-resolves every `[[wikilink]]` in this brain against current document paths and overwrites the `document_links` table. Scoped per-brain so one brain's sync doesn't rebuild the whole tenant.
- **`updateDocumentEmbedding(tenant, id)`** calls Voyage's embeddings API with the prepared text (title + tags + stripped body), and runs a raw `UPDATE vault_documents SET embedding = $1::vector WHERE id = $2` on the tenant client. Prisma cannot express pgvector columns, so it is `$executeRawUnsafe` against a `::vector` cast. The HNSW index picks the new row up automatically.

If either fails, the log line is all we get — there is no retry queue. The standalone backfill script (`scripts/backfill-embeddings.ts`) and the cron route (`src/app/api/cron/backfill-embeddings/route.ts`, which iterates every active tenant) exist precisely to sweep up anything that missed.

### 11. Response

The handler returns `NextResponse.json(doc, { status: 201 })`. The CLI parses the response body, prints the document ID, and exits.

## Why this shape

- **No middleware, every guard inline.** Next.js middleware runs in the Edge runtime; our auth path needs `pg` and `scrypt` (Node-only). Route-level guards keep the whole request on the Node runtime and make the auth chain visible in the file you are editing.
- **`withTenant` is the canonical entry point.** Every tenant-touching route resolves the org first, hands control to `withTenant`, and works inside the transaction it opens. That transaction is what makes RLS enforceable — `SET LOCAL` pins the variable for the lifetime of the transaction and no longer.
- **Fire-and-forget async work.** The write path talks to exactly one external service (the tenant DB). Embeddings and link rebuilds depend on Voyage and expensive scans that we don't want on the critical path. The backfill safety net makes eventual consistency acceptable.
- **Transactions for correctness, not performance.** Every tenant write that produces more than one row runs inside the `withTenant` transaction. The few milliseconds cost is worth the guarantee that the change log never disagrees with the actual data.

## Read-path variants

- **`GET /api/vault/search`** → same auth + `withTenant` + brain resolution, then a Postgres FTS query over the tsvector columns built in `prisma/tenant/fts-setup/migration.sql`. No embeddings involved.
- **`POST /api/vault/semantic-search`** → auth, `withTenant`, brain resolution, `generateEmbedding(query, "query")` via Voyage, then `ORDER BY embedding <=> $1::vector LIMIT n` using the HNSW index.
- **`POST /api/mcp`** → same auth, resolves `organizationId` from the pinned API key (or `user.personalOrgId`), then hands off to the MCP SDK's `McpServer` whose tool handlers are bound to `{ userId, organizationId, identity }`. Every MCP tool ultimately calls into `withTenant` the same way the HTTP routes do. Production URL: `https://mcp.aju.sh/mcp`.
