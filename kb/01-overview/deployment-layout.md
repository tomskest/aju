---
title: Deployment layout
description: Web app, Cloudflare Worker, cron jobs, migration scripts, and how they come up in production.
order: 50
---

# Deployment layout

aju has three deployable units. They do not share a runtime.

1. **The Next.js web app** — HTTP API, dashboard UI, MCP Streamable HTTP endpoint at `mcp.aju.sh/mcp`. Runs on Node.js. Hosted on Railway in production.
2. **The Cloudflare Worker at `install.aju.sh`** — serves the install shell/PowerShell scripts and a JSON manifest of the latest CLI release. Zero-state.
3. **The Go CLI (`aju`)** — distributed as per-platform static binaries via GitHub Releases. Users install it with `curl -fsSL install.aju.sh | sh`.

The app talks to a single **Neon project** (`aju.sh`, id `shiny-union-36888903`, region `aws-eu-central-1`) that hosts one control database (`aju_control`) plus one tenant database per organization (`org_<cuid>`). See [tech-stack.md](./tech-stack.md) for the split-client setup.

There is also a **local MCP stdio server** (`client/mcp/aju-server.ts`) that runs as a subprocess of the user's MCP client. It is not deployed anywhere — it ships with the web app's source. The remote `/api/mcp` endpoint is the preferred path; the stdio bridge is retained for legacy clients.

## The web app

### Process model

Single Node.js process per instance, started by `npm start`:

```json
// package.json
"start": "prisma migrate deploy --schema data/control/schema.prisma && tsx scripts/tenant-migrate.ts && next start"
```

The startup chain does two things before `next start`:

1. **`prisma migrate deploy --schema data/control/schema.prisma`** — applies any pending control-plane migrations to `aju_control` from the numbered migration files under `data/control/migrations/`. The Prisma clients were generated at build time by `npm run build`. Migration history is committed to the repo and is the only path schema changes take to production — there is no `db push --accept-data-loss` shortcut on the boot path.
2. **`tsx scripts/tenant-migrate.ts`** — enumerates every `tenant.status='active'` row, acquires a per-DB advisory lock, applies pending tenant migrations against each tenant's direct DSN, re-applies `vector-setup.sql`, `fts-setup/*.sql`, and `rls-policies.sql`, then bumps the tenant's `schema_version`. Every statement is idempotent.
3. **`next start`** — serves the app.

**Why this sequence runs on every boot.** Railway redeploys create fresh containers; baking the control-schema migrate and per-tenant migrate into `start` means an instance is never serving traffic against a stale schema. A tenant whose recorded `schema_version` is behind the code-side `CURRENT_TENANT_SCHEMA_VERSION` gets flagged via `TenantSchemaDriftError` in `tenantDbFor`, so a failed per-tenant migrate surfaces at request time rather than silently rotting.

### Routes

The HTTP surface lives entirely under `src/app/api/`. The main groups:

| Path | What | Source |
|---|---|---|
| `/api/vault/create`, `update`, `delete`, `document` | CRUD on markdown docs | `src/app/api/vault/*/route.ts` |
| `/api/vault/search` | Postgres FTS over tsvector | `src/app/api/vault/search/route.ts` |
| `/api/vault/semantic-search` | pgvector cosine | `src/app/api/vault/semantic-search/route.ts` |
| `/api/vault/deep-search` | FTS + vector hybrid | `src/app/api/vault/deep-search/` |
| `/api/vault/backlinks`, `related`, `graph` | Document link graph | `src/app/api/vault/*/route.ts` |
| `/api/vault/files` | Binary uploads, S3 presigns | `src/app/api/vault/files/` |
| `/api/mcp` | Remote MCP Streamable HTTP | `src/app/api/mcp/route.ts` |
| `/api/cron/backfill-embeddings` | Sweep missing vectors | `src/app/api/cron/backfill-embeddings/route.ts` |
| `/api/cron/rebuild-links` | Full link graph rebuild | `src/app/api/cron/rebuild-links/route.ts` |
| `/api/auth/*`, `/api/keys`, `/api/orgs/*` | Identity, API keys, org management | `src/app/api/` |
| `/api/signup`, `/api/verify`, `/api/waitlist`, `/api/invitations` | Onboarding flows | `src/app/api/` |

### Scheduled jobs

Cron endpoints are authenticated HTTP POSTs gated by `CRON_SECRET` (timing-safe comparison in the route handler). They do not poll; something external has to hit them. On Railway that "something" is the platform's scheduled trigger feature, which is configured to POST to each route with the secret in the `Authorization` header.

The two jobs:

- **`POST /api/cron/backfill-embeddings`** — iterates every `tenant.status='active'` row in the control DB, opens the per-tenant client, and sweeps every `vault_documents.embedding IS NULL` row plus every `vault_files.embedding IS NULL AND extracted_text IS NOT NULL` row in that tenant. Embeds in batches of 100 via Voyage, writes back with raw `UPDATE ... ::vector`. Source: `src/app/api/cron/backfill-embeddings/route.ts`.
- **`POST /api/cron/rebuild-links`** — same shape: walks every active tenant DB and rebuilds the `document_links` table by re-resolving every wikilink against current paths.

Both are idempotent by design — they only touch rows that need work, per tenant.

### Async workers — what they are and aren't

There is no Sidekiq/Bull/RabbitMQ in this stack. What the code calls "async" work falls into two categories:

1. **Fire-and-forget in-process.** `updateDocumentEmbedding(id)` and `rebuildLinks()` after a write (`src/app/api/vault/create/route.ts:89-96`). These run on the same Node process that handled the request. If the instance dies mid-flight, the cron backfill catches it on the next sweep.
2. **Cron-driven HTTP endpoints.** See above. Still running on the main web process; cron just kicks them.

The `workers/` directory at the repo root is **not** async job workers in this sense. It contains exactly one Cloudflare Worker — see below.

## The install worker

Source: `worker/install/src/index.ts`, config `worker/install/wrangler.toml`.

Deployed to Cloudflare Workers as the custom domain `install.aju.sh`. Three things it serves:

- `GET /` (and `/install.sh`) → rendered POSIX shell installer that detects OS/arch, downloads the matching binary from GitHub Releases, verifies its sha256 against `checksums.txt`, installs to `~/.local/bin` (or `$AJU_INSTALL_DIR`), and chmods +x.
- `GET /ps1` (and `/install.ps1`) → Windows PowerShell equivalent, writes into `%LOCALAPPDATA%\aju\bin`.
- `GET /cli-manifest.json` → JSON manifest with the latest tag, minimum supported version, and per-platform download URLs. Used by the CLI itself to check for updates.

All three are cached at the Worker edge (`Cache-Control: public, max-age=300` for installers, same for the manifest, 60s fallback when GitHub's API fails).

**Why a Worker and not a static page.** The installer script is rendered at request time from env vars (`GITHUB_REPO`, `BINARY_NAME`, `DEFAULT_INSTALL_DIR`) so the repo fork is swappable without rebuilds, and the version query string (`?version=cli-v0.1.0`) changes the download URL on the fly (`worker/install/src/index.ts:40-51`).

**Why a separate repo-within-the-repo.** `worker/install/package.json` has its own `wrangler` dependency; keeping it isolated means the Next.js app doesn't pull Cloudflare tooling into its node_modules.

## Migration and backfill scripts

All live in `scripts/` and run via `tsx`. Summary:

| Script | When to run | What it does |
|---|---|---|
| `tenant-migrate.ts` | Every boot; also manually after changes to `data/tenant/` | Walks every `tenant.status='active'` row, acquires an advisory lock, runs `prisma db push --schema data/tenant/schema.prisma` against that tenant's direct DSN, re-applies the setup SQL (vector, FTS, RLS), and bumps `schema_version`. Idempotent. |
| `provision-existing-orgs.ts` | Manually, when backfilling orgs that pre-date per-tenant DBs | Iterates orgs with no `Tenant` row and calls `provisionTenant(orgId)` for each. |
| `retry-provision.ts` | Manually, to retry tenants stuck in `status='provisioning'` | Re-runs `provisionTenant` — safe because every step is idempotent. |
| `backfill-embeddings.ts` | Manually, when a bulk re-index is needed | Same logic as the cron route, but runnable from a shell. Useful after changing the embedding model. |
| `kill-app.ts` | Local dev only | Terminates stale Postgres connections from crashed `next dev` processes. |

npm script aliases in `package.json`:

```json
"db:push:control": "prisma db push --schema data/control/schema.prisma",
"db:migrate:control": "prisma migrate dev --schema data/control/schema.prisma",
"db:migrate:tenant": "tsx scripts/tenant-migrate.ts",
"db:provision:sweep": "tsx scripts/provision-existing-orgs.ts",
"backfill:embeddings": "npx tsx scripts/backfill-embeddings.ts"
```

**Why tsx, not compiled JS.** These scripts run rarely and need to import straight from `src/lib/*.ts` (the embeddings backfill reuses `generateEmbeddings` from `src/lib/embeddings/embeddings.ts`; `tenant-migrate.ts` reuses `decryptDsn` and `CURRENT_TENANT_SCHEMA_VERSION`). Compiling them would fork the build graph. `tsx` runs TypeScript directly at operator-acceptable speed.

## Per-tenant provisioning and teardown

New orgs trigger `provisionTenant(orgId)` synchronously in the request that creates the org (`src/app/api/verify/route.ts` for personal orgs, `src/app/api/orgs/route.ts` for team orgs). The function:

1. Upserts a `Tenant` row with `status='provisioning'`.
2. Creates role `org_<cuid>_app` via the Neon HTTP API.
3. Creates database `org_<cuid>` owned by that role.
4. Applies the tenant Prisma schema + `CREATE EXTENSION vector, pg_trgm` + the FTS and RLS SQL files.
5. Encrypts the direct + pooled DSNs with AES-GCM (`TENANT_DSN_ENC_KEY`) and writes them to the tenant row.
6. Flips `status='active'`, stamps `schema_version = CURRENT_TENANT_SCHEMA_VERSION`.
7. Seeds a default brain + owner `BrainAccess` row.

Org deletion runs `deleteOrganizationWithStorage(orgId)` (`src/lib/brain-delete.ts`): wipe S3 objects per brain, evict cached tenant clients, call `destroyTenant` (Neon API drops the DB + role and deletes the tenant row), then delete the org row in the control DB. Both `destroyTenant` and `deleteOrganizationWithStorage` swallow 404 / P2025, so partial-failure retries are safe.

## The Go CLI

Source: `client/cli/`. Not covered in depth here — see the dedicated CLI section of the KB. Relevant to deployment: GitHub Releases builds per-platform static binaries tagged `cli-vX.Y.Z`. The install worker reads the latest release via GitHub's API to populate the manifest (`worker/install/src/index.ts:113-151`).

## The local MCP stdio server

`client/mcp/aju-server.ts`. Runs as a subprocess of an MCP client (Claude Desktop, Cursor). Authenticates the same way the CLI does — with an `aju_live_*` bearer token — and proxies MCP tool calls to the hosted HTTP API.

The remote MCP endpoint is the preferred path for clients that support Streamable HTTP. Production URL: `https://mcp.aju.sh/mcp` (configurable via `NEXT_PUBLIC_MCP_URL`). The stdio server exists because some clients still only speak the original stdio transport.
