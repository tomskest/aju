---
title: Overview and architecture
description: What aju is, the stack it runs on, how a request flows through it, and how to self-host it.
order: 10
---

# Overview and architecture

aju is an open-source memory backend for AI agents. It stores markdown documents and binary files, indexes them for text and vector search, tracks the wikilink graph between them, and exposes everything through a small HTTP API plus an MCP server. The hosted product runs at [aju.sh](https://aju.sh); the source is at [github.com/tomskest/aju](https://github.com/tomskest/aju).

This section covers the load-bearing pieces of the system from the outside in:

1. [What aju is and why](./what-aju-is.md) — the problem statement and the design principles that fall out of it.
2. [Tech stack](./tech-stack.md) — the runtime, framework, database, storage, and external services, each with the reason it was picked.
3. [Request lifecycle](./request-lifecycle.md) — how an HTTP request becomes Postgres rows, S3 objects, and an embedded vector.
4. [Deployment layout](./deployment-layout.md) — how the web app, the Cloudflare install worker, and the migration/backfill scripts fit together.
5. [Self-hosting](./self-hosting.md) — the env vars, the docker-compose dev loop, and the commands to migrate and backfill.

If you only read one file, read [request-lifecycle.md](./request-lifecycle.md) — it is the shortest path to understanding how the pieces wire up.

## Repository map

The source tree the rest of this section refers to:

```
aju/
├── src/
│   ├── app/              # Next.js 15 App Router — routes, pages, API handlers
│   │   └── api/          # HTTP API (vault CRUD, search, auth, MCP, cron)
│   ├── components/       # React UI: app shell, brain editor, landing, OAuth
│   └── lib/              # Domain folders: auth/, tenant/, vault/, embeddings/,
│                         #   storage/, billing/, mcp/, audit/, validators/
├── data/
│   ├── control/
│   │   └── schema.prisma # Control-plane schema → @prisma/client
│   └── tenant/
│       ├── schema.prisma # Per-org schema → @prisma/client-tenant
│       ├── fts-setup/*.sql
│       ├── vector-setup.sql
│       └── rls-policies.sql # Brain-id RLS, applied inside each tenant DB
├── scripts/              # tenant-migrate, provision-existing-orgs, backfill-*
├── client/
│   ├── cli/              # Go CLI (`aju`) — talks to the HTTP API
│   ├── mcp/
│   │   └── aju-server.ts # Local MCP stdio server (legacy; remote /api/mcp preferred)
│   └── openapi/          # OpenAPI YAML + auto-generated SDKs (ts, py, go, sh)
├── worker/
│   └── install/          # Cloudflare Worker for install.aju.sh
├── kb/                   # This public knowledge base (rendered at aju.sh/kb)
├── doc/                  # Internal runbooks (Neon migration, Prisma, backups)
├── benchmark/            # LongMemEval benchmark harness
├── docker-compose.yml    # Dev-only pgvector/pg17 container
└── package.json
```

See [`CLAUDE.md`](https://github.com/tomskest/aju/blob/main/CLAUDE.md) in the repo for the short internal conventions note (magic-link auth, one Postgres database per organization, brain-id RLS inside each tenant DB, API keys pinned to exactly one org).
