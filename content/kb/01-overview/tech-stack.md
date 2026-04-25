---
title: Tech stack
description: Every runtime dependency, what it does, and why it was picked over the alternatives.
order: 30
---

# Tech stack

Every version below is pinned from `package.json` in the repo root. The "why" paragraphs are the actual tradeoffs — not marketing.

## Runtime and framework

### Next.js 15, App Router

`next: ^15`, configured in `next.config.ts`.

```ts
// next.config.ts
const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "pdf-parse"],
};
```

The entire HTTP surface is Next.js App Router route handlers under `src/app/api/`. The dashboard pages live under `src/app/app/`, `src/app/docs/`, `src/app/welcome/`, etc. There is no separate Express/Fastify server.

**Why Next.js.** Single deploy unit (web + API), streaming primitives for the remote MCP endpoint (`src/app/api/mcp/route.ts`), and the App Router's file-based routing keeps the API surface visible in the tree. The `serverExternalPackages` entries are required because `pg` and `pdf-parse` ship native code / CJS quirks that Next's bundler would otherwise mangle.

**Tradeoff.** We inherit all of Next's deploy constraints. Long-running workers (embedding backfills, link rebuilds) live behind cron-triggered routes rather than as persistent processes — fine for our load, but something to revisit if throughput grows.

### React 19

`react: ^19`, `react-dom: ^19`. Server Components by default; the dashboard uses interactive client components where needed.

**Why.** Ships with Next 15 and lets us use `async` Server Components for dashboard pages that need DB reads without client-side fetching.

### TypeScript 5

`typescript: ^5`, strict mode. No `.js` files in `src/`.

## Data layer

### Postgres 17 + pgvector (Neon, one project, many databases)

`docker-compose.yml` pins `pgvector/pgvector:pg17` for local dev. Production runs on a single Neon project (`aju.sh`, project id `shiny-union-36888903`, region `aws-eu-central-1`) that hosts one control database plus one per-org tenant database.

- **`aju_control`** — global identity, orgs, memberships, API keys, OAuth, device codes, waitlist, and the `Tenant` routing table.
- **`org_<cuid>`** — one per organization. Holds `Brain`, `BrainAccess`, `Agent`, `VaultDocument`, `DocumentLink`, `VaultChangeLog`, `VaultFile`.

Extensions loaded in every tenant DB at provision time (`prisma/tenant/vector-setup.sql`, `prisma/tenant/fts-setup/*.sql`):

- `vector` — pgvector for embeddings
- `pg_trgm` — trigram indexes for fuzzy title/filename search
- Native `tsvector` — full-text search columns + GIN indexes + triggers

**Why Postgres + Neon.** We need relational data, FTS, vector search, and strong isolation. Postgres does the first three in one engine; Neon makes per-org DBs cheap (logical, not separate clusters) so the org boundary can sit at the database level without a cost explosion.

**Why pg17 + pgvector.** HNSW indexes give sub-millisecond nearest-neighbour queries at our scale. pg17's improvements to `pg_stat_io` help diagnose vector index I/O without bolting on an extension.

### Prisma 6 (split clients)

`prisma: ^6`, `@prisma/client: ^6`. Two schemas, two generated clients:

- `prisma/control/schema.prisma` → `@prisma/client` (singleton in `src/lib/db.ts`, connected to `DATABASE_URL` / `CONTROL_POOLED_URL`).
- `prisma/tenant/schema.prisma` → `@prisma/client-tenant` (output under `node_modules/@prisma/client-tenant`). `tenantDbFor(orgId)` returns a `PrismaClientTenant` pinned to that org's encrypted DSN, cached in an LRU with a 10-minute idle reaper.

```ts
export const prisma = globalForPrisma.prisma ?? makeControlClient();
export async function tenantDbFor(orgId: string): Promise<PrismaClientTenant> { ... }
```

**Why Prisma.** Type-safe queries, generated types that track each schema, first-class migrations. The generated tenant types flow through every vault route handler.

**Tradeoff.** Prisma does not model Postgres features we depend on (tsvector columns, vector columns, triggers, RLS policies). Those live in raw SQL files under `prisma/tenant/` and are applied per-tenant by `src/lib/tenant-provision.ts` and `scripts/tenant-migrate.ts`. See [deployment-layout.md](./deployment-layout.md) for the boot sequence.

### pg (raw client)

`pg: ^8` is pulled in directly by `src/lib/tenant-provision.ts` and `scripts/tenant-migrate.ts` to run the per-tenant setup SQL (extensions, FTS triggers, vector indexes, RLS) against a freshly-created tenant DB.

## Object storage

### S3-compatible via AWS SDK v3

`@aws-sdk/client-s3: ^3.992.0`, `@aws-sdk/s3-request-presigner: ^3.992.0`.

The client in `src/lib/s3.ts:13-22` is configured purely from env vars (`AWS_ENDPOINT_URL`, `AWS_DEFAULT_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`). That means any S3-compatible provider works: Cloudflare R2, Backblaze B2, MinIO, AWS proper.

**Why AWS SDK with a custom endpoint.** One codepath, every provider. Production on Railway uses the managed Bucket add-on (S3-compatible); self-hosters can point at R2 for zero egress cost or MinIO for fully local dev.

**What is in S3.** Binary files uploaded as `VaultFile` rows. The S3 key is stored on the row, plus a cached `extractedText` (PDF text extraction via `pdf-parse`) for search.

## Auth and bot protection

### Better-Auth (magic links + OAuth)

Better-Auth owns the `user`, `session`, `account`, `verification` tables in the control DB. See `prisma/control/schema.prisma`. The project CLAUDE.md lists magic-link email as the primary signup path.

**Why Better-Auth.** It models both email magic links and OAuth providers in one library, with a Prisma adapter. The alternative (roll your own or use NextAuth) traded implementation cost against maintenance pain; Better-Auth is small enough to audit.

### API keys (home-grown)

Bearer tokens on `Authorization: Bearer aju_live_…`. Stored as `prefix` (first 12 chars, searchable) + `hash` (scrypt of the remainder) in the control DB. See `src/lib/auth.ts` and the `ApiKey` model at `prisma/control/schema.prisma`. Every key is pinned to exactly one `organizationId` at mint time — the key's requests always route to that one org's tenant DB.

**Why not use Better-Auth's keys.** We need scoping (`read`, `write`), per-key last-used tracking, and mandatory org-pinning — the schema encodes all three directly on the `ApiKey` row.

### Cloudflare Turnstile

`src/lib/turnstile.ts` — server-side siteverify call. Site key read on the client from `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, secret from `TURNSTILE_SECRET_KEY`. Fails open in dev when the secret is unset (`src/lib/turnstile.ts:20-28`) so local loops aren't blocked.

**Why Turnstile over reCAPTCHA.** No tracking, no cookie banners, Cloudflare-hosted, free tier is generous. The tradeoff is that users without JS get blocked from signup.

## AI providers

### Voyage AI (embeddings)

`src/lib/embeddings.ts:12-120`. Model is `voyage-4-large`, 1024-dim, 32K-token context.

```ts
const VOYAGE_API = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-4-large";
```

**Why Voyage.** The comment at the top of `embeddings.ts` is explicit: Voyage measured better on retrieval quality for developer/agent-memory corpora. A planned BYOK layer is noted at `embeddings.ts:7` for callers who want to swap providers later.

**Tradeoff.** Voyage has a smaller partner ecosystem than the OpenAI/Cohere incumbents. The 1024-dim vectors are compact relative to the 1536-dim alternatives, which keeps HNSW index footprint small.

### Anthropic SDK

`@anthropic-ai/sdk: ^0.77.0`. Present in dependencies but the primary read-path doesn't call Anthropic directly — it is available for future agent-facing features (summaries, rewrites).

**TODO: verify** where the Anthropic SDK is invoked at runtime. It is listed in `package.json:20` but no direct usage was located during this pass.

## MCP

### @modelcontextprotocol/sdk v1

`@modelcontextprotocol/sdk: ^1`. Two transports:

- **Remote (Streamable HTTP):** `src/app/api/mcp/route.ts` wires `WebStandardStreamableHTTPServerTransport` into a Next.js route handler. Every request builds a fresh `McpServer` bound to the authenticated user; the spec permits stateless mode and Claude-family clients accept it.
- **Local (stdio):** `mcp/aju-server.ts` runs as a separate Node process that talks to the hosted API over HTTP. Intended for clients that can't authenticate to a remote MCP endpoint.

Tool definitions are shared at `src/lib/mcp/tools.ts` so both transports expose the same surface.

**Why both.** Remote transport works for Claude.ai where users can paste a bearer token into the integration form. Stdio transport is the fallback for Cursor, VS Code, and anything else that only speaks the original MCP transport.

## Transactional email

### Resend

`src/lib/email.ts` — `RESEND_API_KEY` and `EMAIL_FROM` env vars. Used for magic links, invitations, and access-request notifications.

**Why Resend.** Good deliverability, developer-shaped API, clean TypeScript SDK. Postmark and SendGrid were the alternatives.

## Payload utilities

- `zod: ^3` — request body validation in route handlers
- `gray-matter: ^4` — YAML frontmatter parsing in `src/lib/vault-parse.ts`
- `diff: ^8.0.3` — text diffing on updates for the change log
- `pdf-parse: ^2.4.5` — extract searchable text from uploaded PDFs

## Front-end

- Tailwind CSS v4 via `@tailwindcss/postcss`
- PostCSS
- Geist Sans / Geist Mono (Google Fonts via `next/font`, `src/app/layout.tsx:5-15`)

No client-state library — pages read from the server and forms POST to API routes. This is deliberate: fewer moving parts, the dashboard is low-interactivity.

## Tooling

- `tsx: ^4` runs the scripts in `scripts/` and the MCP stdio server without a build step.
- Prisma CLI handles `migrate`, `db push`, `generate`.
- Cloudflare Wrangler for the install worker (`workers/install/package.json:11-15`).
