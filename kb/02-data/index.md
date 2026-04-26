---
title: Data model, storage, and privacy
description: How aju models, stores, isolates, exports, and deletes your data.
order: 10
---

# Data model, storage, and privacy

aju is a memory backend for AI agents. Everything else in the product — the
CLI, the MCP server, the web UI, the cron jobs — sits on top of the data model
described in this section. If you want to understand aju's trust posture,
start here.

The shape is deliberately small:

- **Postgres** holds every piece of structured state, split across two planes:
  the **control DB** (`aju_control`) for identity, organizations, memberships,
  invitations, API keys, OAuth tables, and the tenant routing table; and one
  **tenant DB** per organization (`org_<cuid>`) for brains, markdown documents
  (including their full body text), the wikilink graph, change log, and file
  *metadata*.
- **Object storage** (Tigris in production, any S3-compatible endpoint
  for self-hosters) holds *only* the binary contents of uploaded files.
  Nothing queryable lives there.
- **Voyage AI** receives document and file text for embedding, nothing else.

Tenant isolation runs at two layers: **the database boundary** (each org gets
its own Postgres DB; a connection string only grants access to one org's data)
and **brain-id RLS** inside each tenant DB (policies gated by the session
variable `app.current_brain_ids`, set via `SET LOCAL` in `withBrainContext` /
`withTenant`). The DB boundary handles cross-org isolation; RLS is defense
in depth inside one org — if an app-layer query forgets a `brainId` filter,
RLS still blocks reads across brains the caller doesn't have access to.

## What's in this section

1. [schema.md](./schema.md) — Every Prisma model and why it exists.
2. [brains.md](./brains.md) — Brains as namespaces, access roles, personal vs
   org brains.
3. [documents-and-versioning.md](./documents-and-versioning.md) — Markdown +
   frontmatter storage, path semantics, wikilink parsing, the change log.
4. [files-and-storage.md](./files-and-storage.md) — Binary uploads, presigned
   URLs, text extraction, categories.
5. [tenant-isolation.md](./tenant-isolation.md) — Organizations, RLS, and how
   rows stay scoped to a tenant.
6. [export-and-deletion.md](./export-and-deletion.md) — Signout, brain delete,
   `/api/me/export`, and the "your data is yours" promise.
7. [privacy.md](./privacy.md) — What leaves your machine, what's stored where,
   what the embedding provider sees.

## Reading this section end-to-end

Read `schema.md` first — every other file assumes you've seen the Prisma
models. `brains.md` and `documents-and-versioning.md` cover the hot paths.
`tenant-isolation.md` is required reading if you're evaluating aju for
multi-tenant use. `export-and-deletion.md` and `privacy.md` answer the
compliance questions.
