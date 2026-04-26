---
title: Self-hosting
description: Env vars, docker-compose, migrations, and the commands that take you from fresh checkout to running server.
order: 60
---

# Self-hosting

aju is designed to run on someone else's machine. The hosted tier at aju.sh is the same codebase with the same env vars pointed at different providers.

Source: [`github.com/tomskest/aju`](https://github.com/tomskest/aju), Apache 2.0. The in-app self-host guide lives at `/doc/self-host` (source: `src/app/doc/self-host/page.tsx`).

## Prerequisites

- **Node.js 20+** (Next 15 + React 19 require a recent LTS)
- **Postgres 15 or newer with the `pgvector` extension**. The dev `docker-compose.yml` pins pg17; any version from 15 onward with pgvector installed will work.
- **A Neon project** for production, with the Neon API key that can create databases + roles on it. Local dev can point at the docker-compose Postgres and set `USE_LOCAL_TENANT_DB=1` — see below.
- **An S3-compatible bucket** — AWS S3, Cloudflare R2, Backblaze B2, or MinIO
- **A Resend account** for transactional email (magic links, invitations)
- **A Cloudflare Turnstile site key + secret** — or leave `TURNSTILE_SECRET_KEY` unset in dev and it fails open (`src/lib/turnstile.ts`)
- **A Voyage AI API key** for embeddings (`src/lib/embeddings/embeddings.ts`)

## Environment variables

Copy `.env.example` to `.env.local` and fill it in. The reference list, grouped by subsystem:

### Runtime

| Var | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `NEXT_PUBLIC_APP_URL` | Public URL of this deployment (used in outgoing emails — `src/app/api/signup/route.ts` and friends) |
| `NEXT_PUBLIC_LANDING_URL` | Public URL of the landing page (usually same as `NEXT_PUBLIC_APP_URL`) |

### Database

Control plane:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Direct (non-pooled) DSN for `aju_control`. Used by Prisma CLI for migrations and DDL. |
| `CONTROL_POOLED_URL` | Optional. PgBouncer (transaction-mode) DSN for runtime queries against the control DB on Neon. Append `?pgbouncer=true`. Leave unset in local dev — the app falls back to `DATABASE_URL`. |

Tenant plane (per-org DBs provisioned on demand):

| Var | Purpose |
|---|---|
| `NEON_API_KEY` | Personal or org Neon API key with DB/role create permissions. |
| `NEON_PROJECT_ID` | Neon project id that hosts the tenant DBs (prod is `shiny-union-36888903`). |
| `TENANT_DSN_ENC_KEY` | AES-GCM key used to encrypt the per-tenant DSNs stored in the `tenant` table. Generate with `openssl rand -base64 32`. |
| `USE_LOCAL_TENANT_DB` | Dev escape hatch — `=1` makes `tenantDbFor` return a single `PrismaClient` pointed at `DATABASE_URL` instead of talking to Neon. The tenant schema is applied to the control DB alongside the control schema. Never set in production. |
| `TENANT_CLIENT_CACHE_MAX` | LRU ceiling for cached tenant Prisma clients (default 30). Each client holds ~30-50 MB plus a connection pool — tune to RAM headroom. |

### Object storage

| Var | Purpose |
|---|---|
| `AWS_ENDPOINT_URL` | Custom S3 endpoint (required for R2, MinIO; leave blank for AWS S3) |
| `AWS_DEFAULT_REGION` | Bucket region, e.g. `auto` (R2) or `us-east-1` |
| `AWS_ACCESS_KEY_ID` | Bucket read/write key |
| `AWS_SECRET_ACCESS_KEY` | Bucket read/write secret |
| `AWS_S3_BUCKET_NAME` | Bucket name |

These provide the **fallback** path used by self-hosters and local dev. In production each tenant has its own bucket + scoped credentials, encrypted on the `Tenant` row and decrypted by `src/lib/tenant/storage.ts` at request time. The shared `AWS_*` vars are only consulted when a tenant has no per-org bucket configured yet.

### Auth and identity

| Var | Purpose |
|---|---|
| `BETTER_AUTH_SECRET` | 32-byte random secret for Better-Auth session signing. Generate with `openssl rand -base64 32`. |
| `EMAIL_FROM` | Verified sender address for transactional email (`src/lib/email.ts`). |
| `RESEND_API_KEY` | Resend API key for magic links / invitations (`src/lib/email.ts`). |

### MCP endpoint

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_MCP_URL` | URL shown in onboarding + docs for MCP client setup. Production: `https://mcp.aju.sh/mcp`. Override for staging or local dev. |

### Bot protection

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Public Turnstile site key, rendered on the signup form. |
| `TURNSTILE_SECRET_KEY` | Server-side siteverify secret (`src/lib/turnstile.ts`). |

### AI providers

| Var | Purpose |
|---|---|
| `VOYAGE_API_KEY` | Voyage AI key for embeddings (`src/lib/embeddings/embeddings.ts`). Required for semantic search and the embedding backfill. Model is `voyage-4-large`, 1024-dim. |
| `ANTHROPIC_API_KEY` | Optional. Used only by the LongMemEval benchmark harness (`benchmark/longmemeval/`) — Sonnet 4.6 as answerer, Haiku 4.5 as judge. The main app runtime never calls Anthropic. Skip this var unless you plan to run the benchmark. |

### Legacy single-tenant API keys (optional)

Still honoured by `src/lib/auth.ts`. Useful for early single-tenant deployments before creating user accounts:

| Var | Purpose |
|---|---|
| `API_KEY` | Admin token; identity becomes `"admin"` |
| `API_KEY_<NAME>` | Member token; identity becomes `<name>` lowercased, underscores → hyphens |

New deployments should use database-backed keys (`aju_live_*`) issued through the dashboard once a user is signed in. Every minted key is pinned to one organization.

## Run Postgres locally with docker-compose

The full `docker-compose.yml`:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_USER: aju
      POSTGRES_PASSWORD: aju_dev
      POSTGRES_DB: aju
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Notes:

- The image is [`pgvector/pgvector:pg17`](https://hub.docker.com/r/pgvector/pgvector), which is stock Postgres 17 with pgvector pre-installed. No manual `CREATE EXTENSION` required — `scripts/tenant-migrate.ts` runs it at boot.
- The container exposes port `5433` on the host to avoid conflicting with a local Postgres on the default 5432. The `.env.example` `DATABASE_URL` points at `localhost:5433`.
- `pgdata` is a named volume. Wipe it with `docker compose down -v` when you need a clean DB.
- In this single-container setup set `USE_LOCAL_TENANT_DB=1`. The app runs the tenant schema alongside the control schema in the same DB, and `tenantDbFor` returns a client pointed at `DATABASE_URL` for every orgId. Perfect for loopback dev; never use in production.

## From zero to running

```bash
# 1. clone
git clone https://github.com/tomskest/aju.git
cd aju

# 2. configure
cp .env.example .env.local
# edit .env.local — at minimum set DATABASE_URL, RESEND_API_KEY,
# EMAIL_FROM, BETTER_AUTH_SECRET, VOYAGE_API_KEY, TENANT_DSN_ENC_KEY,
# USE_LOCAL_TENANT_DB=1, and the AWS_* vars

# 3. start postgres
docker compose up -d

# 4. install deps (postinstall runs `prisma generate` for both schemas)
npm install

# 5. sync control schema + apply tenant schema/SQL to the shared DB
npm run db:push:control
npm run db:migrate:tenant   # USE_LOCAL_TENANT_DB=1 → applies tenant schema to DATABASE_URL

# 6. run the app
npm run dev
```

The dev server comes up on `http://localhost:3000`. Sign up via the landing page; the magic link will be emailed (or, if `RESEND_API_KEY` is unset in dev, `src/lib/email.ts` logs it to the console).

For production-like local dev against real Neon tenant DBs, unset `USE_LOCAL_TENANT_DB`, set `NEON_API_KEY` + `NEON_PROJECT_ID`, and `provisionTenant` will create a fresh `org_<cuid>` database on first signup.

## Production start

In production, `npm start` does the migration work for you (see [deployment-layout.md](./deployment-layout.md)):

```json
"start": "prisma migrate deploy --schema data/control/schema.prisma && tsx scripts/tenant-migrate.ts && next start"
```

`prisma migrate deploy` applies the numbered migration files under `data/control/migrations/` to `aju_control`. There is no `db push --accept-data-loss` shortcut on the boot path — every schema change goes through a committed migration. `scripts/tenant-migrate.ts` then walks every active tenant on boot and brings its schema + RLS up to date. RLS policies live in `data/tenant/rls-policies.sql` and are re-applied alongside the schema because all the statements are idempotent (ENABLE RLS is a no-op if already set; policies are dropped + recreated).

## Optional: the install worker

If you are running a public fork with a custom install endpoint, the `worker/install/` directory is a separately deployable Cloudflare Worker. Set `GITHUB_REPO`, `BINARY_NAME`, `DEFAULT_INSTALL_DIR` in `wrangler.toml` and `wrangler deploy`.

Most self-hosters will not need this — either distribute the CLI binary directly, or let your users install it from the public aju.sh binary and point at your deployment with `AJU_API_URL`.

## Verifying the install

Once the app is running, smoke-test with an API key from the dashboard:

```bash
export AJU_API_URL=http://localhost:3000
export AJU_TOKEN=aju_live_…

# create
curl -sX POST "$AJU_API_URL/api/vault/create" \
  -H "Authorization: Bearer $AJU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"hello.md","content":"---\ntitle: Hello\n---\nworld","source":"curl"}'

# search
curl -s "$AJU_API_URL/api/vault/search?q=world" \
  -H "Authorization: Bearer $AJU_TOKEN"
```

If both return 2xx, the web app, Postgres, and Better-Auth are all wired up. The embedding lands asynchronously — give it a few seconds before trying `semantic-search`.

## Where to go next

- The control schema: [`data/control/schema.prisma`](https://github.com/tomskest/aju/blob/main/data/control/schema.prisma)
- The tenant schema: [`data/tenant/schema.prisma`](https://github.com/tomskest/aju/blob/main/data/tenant/schema.prisma)
- The RLS policy file: [`data/tenant/rls-policies.sql`](https://github.com/tomskest/aju/blob/main/data/tenant/rls-policies.sql)
- The CLI source: [`client/cli/`](https://github.com/tomskest/aju/tree/main/client/cli)
- The install worker: [`worker/install/`](https://github.com/tomskest/aju/tree/main/worker/install)
