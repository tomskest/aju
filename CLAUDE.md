# aju

Memory infrastructure for AI agents. CLI-first, open source (Apache 2.0), hosted at aju.sh.

## Stack

- Next.js 15 (App Router) + Prisma + Postgres + pgvector
- Railway (app, Postgres, S3-compatible Bucket)
- Cloudflare (DNS, Turnstile)
- Better-Auth (magic links + OAuth)
- Resend (transactional email)

## Repository structure

```
src/
  app/                    Next.js App Router — pages, API routes, OAuth endpoints
  components/             React components (PascalCase files)
  lib/                    Domain-grouped server libraries (see below)
  middleware.ts           Edge middleware: rate limiting, OAuth debug logging
mcp/aju-server.ts         MCP stdio server (secondary to CLI)
apps/cli                  Go CLI for `aju` command
sdks/{typescript,python,go}  Auto-generated client SDKs from OpenAPI
prisma/control            Control-plane schema (identity, orgs, OAuth, ApiKey)
prisma/tenant             Per-tenant schema (Brain, Documents, Files, etc.)
scripts/                  Dev/ops utilities
```

### `src/lib/` — domain folders

Library code is grouped by domain. Each folder has an `index.ts` barrel so callers
import from `@/lib/<domain>` regardless of which file inside houses the symbol.

```
src/lib/
  auth/                   Bearer + session + API-key crypto + OAuth helpers
    bearer.ts             API-key bearer auth (`authenticate(req)`)
    api-key.ts            Key generation + scrypt verification
    session.ts            Session cookie, currentAuth(), active-org
    oauth/                OAuth 2.1 + PKCE helpers
    index.ts              Barrel export
  tenant/                 Per-org DB provisioning, RLS context, Neon API
    context.ts            withTenant + withBrainContext (RLS scoping)
    provision.ts          New-org tenant DB + RLS policy bootstrap
    storage.ts            Per-tenant Tigris bucket lifecycle
    crypto.ts             Tenant DB credential encryption
    types.ts              OrgRole, MembershipStatus, helpers
    neon-api.ts           Neon control-plane client
    index.ts              Barrel export
  vault/                  Brains, BrainAccess, KB helpers, link graph
    brain.ts              resolveBrain / resolveBrainIds / canWrite
    brain-delete.ts       Cascade-delete a brain across tenant + storage
    kb.ts, kb-markdown.ts Public KB rendering
    parse.ts              Markdown frontmatter + wikilink parser
    link-resolver.ts      Wikilink → document_id resolution
    rebuild-links.ts      Document graph rebuild (+ scheduleRebuildLinks coalescing)
    index.ts              Barrel export
  embeddings/             Voyage AI embedding generation + reindex
    embeddings.ts         generateEmbedding(s), toVectorLiteral
    update.ts             Per-doc / per-file embedding refresh
    reindex.ts            Brain-scoped FTS + embedding + link rebuild
    index.ts              Barrel export
  storage/                S3 keys, Tigris admin, encryption, text extraction
    s3-keys.ts            validateS3PathSegment (key traversal guard)
    tigris-admin.ts       Per-tenant bucket + scoped credentials lifecycle
    crypto.ts             Storage credential encryption (AES-GCM)
    extract-text.ts       PDF / docx / plain-text extraction
    index.ts              Barrel export
  billing/                Plan limits + beta gating
    beta.ts               Beta cohort gating
    plan-limits.ts        enforceApiKeysLimit, enforceStorageLimit, etc.
    public-email-blocklist.ts  Free-mail signup blocklist
    index.ts              Barrel export
  mcp/                    MCP server tool registrations
    tools/{search,vault,shared}.ts
  app-schema.ts           Shared zod schemas
  config.ts               App-level constants (MAX_UPLOAD_BYTES, etc.)
  db.ts                   Control-plane Prisma client + tenantDbFor
  email.ts                Resend wrapper + notification logic
  logger.ts               pino logger
  rate-limit.ts           In-memory rate limiter (per-instance)
  route-helpers.ts        authedTenantRoute / authedUserRoute / authedOrgRoute
  turnstile.ts            Cloudflare Turnstile verification
```

When adding a new utility, place it in the closest existing domain folder. If it
genuinely doesn't belong to any of them, leave it at `src/lib/` root only if it's
cross-cutting (used by ≥3 domains). Otherwise, propose a new domain folder.

## Conventions

### Naming

| Surface                       | Convention                          | Example                          |
|-------------------------------|-------------------------------------|----------------------------------|
| API route segments            | kebab-case                          | `/api/vault/semantic-search`     |
| `src/lib/**` file names       | kebab-case                          | `link-resolver.ts`               |
| React components              | PascalCase (file + symbol)          | `OrgSwitcher.tsx`                |
| TS types/interfaces           | PascalCase                          | `BrainContext`                   |
| Functions / vars              | camelCase                           | `resolveBrain`, `brainId`        |
| Prisma model fields           | camelCase                           | `wordCount`, `brainId`           |
| DB columns                    | snake_case (via `@map`)             | `word_count`, `brain_id`         |
| zod schemas                   | camelCase + `Schema` suffix         | `createBrainSchema`              |
| `apps/cli/cmd/*.go`           | snake_case files, PascalCase funcs  | `agent_keys.go` → `AgentsKeys()` |
| `apps/cli/internal/<pkg>/*.go`| package dir lowercase; primary file matches package | `httpx/client.go`  |
| `scripts/*.ts`                | kebab-case                          | `provision-existing-orgs.ts`     |
| `sdks/{ts,py,go}`              | language-native conventions (auto-generated from openapi) | `ajuclient` (go), `aju` (py module), `@tomskest/aju-sdk` (npm) |
| Examples in CLI help / docs   | use `Acme` (org/brain) as the placeholder; never reference real customers or internal teams | `aju brains create Acme --type org` |

### API routes — use the helpers, not raw boilerplate

API route handlers MUST go through one of the wrappers in `@/lib/route-helpers`:

- **`authedTenantRoute(handler, opts?)`** — most common. Resolves auth + active
  org + membership, opens a tenant transaction with brain-id RLS pinned.
  Handler receives `{ req, tx, tenant, brainIds, principal, user, organizationId, role, params }`.
  Pass `{ unscoped: true }` for tables without `brain_id` (e.g. agent management).
  Pass `{ minRole: "admin" }` to gate by role.
- **`authedUserRoute(handler)`** — only requires a signed-in user. Use for
  self-service routes (own keys, own export) that don't need org/tenant context.
- **`authedOrgRoute(handler, opts?)`** — control-plane org operations on the
  control DB (members, invitations, domains, access requests, switch). Resolves
  the org id from `params[opts.orgIdParam]` (typically `"id"` from
  `/api/orgs/[id]/...`) and verifies the caller is a member with at least
  `opts.minRole` (default `"member"`). Agent principals are rejected with 403
  by default — org roles are human-only, agents carry per-brain access grants
  in the tenant DB.

Don't write `currentAuth(req)` + `prisma.organizationMembership.findFirst` +
`withTenant` directly in a handler. The helpers exist precisely to keep that
prelude out of every file.

### SQL — never use `$queryRawUnsafe` / `$executeRawUnsafe`

Use Prisma's tagged-template `$queryRaw` / `$executeRaw` with `Prisma.sql` /
`Prisma.join` / `Prisma.empty` to compose dynamic fragments. Every value
travels as a bound parameter — there is no string concatenation of user input.

```ts
import { Prisma } from "@prisma/client-tenant";

const filters: Prisma.Sql[] = [
  Prisma.sql`brain_id = ANY(${brainIds}::text[])`,
];
if (section) filters.push(Prisma.sql`section = ${section}`);

const where = Prisma.join(filters, " AND ");
const rows = await tx.$queryRaw<Row[]>`
  SELECT … FROM vault_documents WHERE ${where} LIMIT ${limit}
`;
```

For Postgres `SET LOCAL` (which doesn't accept parameter binding), use
`set_config(name, value, true)` so the value is still bound — see
`tenant/context.ts` for the pattern.

### Pagination — every list endpoint takes `?limit&cursor`

List endpoints should accept `?limit=` (default 100, max 500) and `?cursor=`
(opaque cursor; ISO timestamp for time-ordered, primary-key value for
key-ordered). Fetch `take: limit + 1` and use the extra row to compute
`nextCursor`. Never call `findMany()` without a `take:` cap on a HTTP path.

Strip large `@db.Text` columns (`content`, `extractedText`) from list responses.
Callers fetch document bodies on demand from a detail endpoint.

### OAuth route layout

The OAuth and session-auth surface is split across three URL trees by intent —
this is deliberate, not legacy mess:

| URL                                          | What lives there                              |
|----------------------------------------------|-----------------------------------------------|
| `/.well-known/oauth-{authorization-server,protected-resource}` | RFC 8414 / RFC 9728 discovery (rewritten in `next.config.ts` to `/api/oauth/well-known/*`) |
| `/oauth/authorize` (page)                    | Consent UI                                    |
| `/oauth/{token,revoke,register}`             | RFC 6749 / RFC 7009 / RFC 7591 endpoints      |
| `/api/oauth/authorize/approve`               | POST handler behind the consent UI            |
| `/api/oauth/well-known/*`                    | Implementation behind `/.well-known/*` rewrites |
| `/api/auth/device/{start,approve,poll}`      | Device-grant flow (used by the Go CLI)        |
| `/api/auth/{me,signout}`                     | Session-only (cookie) endpoints               |

The Go CLI in `apps/cli/cmd/{auth,agent_provision}.go` pins
`/api/auth/device/*`. Do not move those paths without coordinating a CLI
release.

## Working on this repo

- Default embedding provider: Voyage AI `voyage-4-large` (1024 dims)
- Every tenant-scoped table uses `brain_id` + Postgres RLS (the org-DB boundary
  is the org scope)
- API keys scoped per brain; owner can be user or agent
- Magic-link verification is the only gate for grandfather-cohort signups
- `currentAuth(req)` resolves principal from cookie OR bearer; never call
  `authenticate(req)` directly outside `route-helpers.ts`
