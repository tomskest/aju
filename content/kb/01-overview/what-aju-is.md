---
title: What aju is and why
description: The problem statement, the target user, and the design principles that shaped the system.
order: 20
---

# What aju is and why

## The one-sentence version

aju is a CLI-first, open-source memory store for AI agents: markdown + files + a wikilink graph + vector search, exposed over HTTP and MCP, with one Postgres database per organization.

The project tagline in the landing page is "memory for AI agents — open-source memory infrastructure for AI agents. CLI-first, MCP-compatible. Install with one line." (`src/app/layout.tsx:17-33`).

## The problem

Agents that run for more than a few turns need a place to remember things. The options today are:

- Stuff everything into the model's context. Cheap to build, but bounded, expensive, and leaks across sessions.
- Use a vector DB as the sole memory. Good for fuzzy recall, bad for auditable facts, structured relations, or human review.
- Store notes in an Obsidian-style vault. Human-friendly, but there is no API, no tenancy, no way for two agents to share it.

aju is what you get if you start from the vault model — markdown files, YAML frontmatter, `[[wikilinks]]`, a folder hierarchy — and then add the things agents need: HTTP API, vector index, one-database-per-org isolation, per-key scoping, MCP transport, and a CLI that binds a local device to a remote brain.

The schema makes this explicit: a **Brain** is a container of documents, a **VaultDocument** is a markdown file with parsed frontmatter, tags, wikilinks, content hash, and a pgvector embedding (`prisma/tenant/schema.prisma`). A **VaultFile** is a binary blob in S3 with extracted text and its own embedding. A **DocumentLink** is a resolved wikilink edge in the graph. All of these live in the per-org tenant database; identity, orgs, memberships, and API keys live in the control database.

## Who it is for

Two audiences, same system:

- **Developers building agents.** They want a fast CLI (`aju search`, `aju create`), a stable HTTP API, and an MCP server they can point Claude Desktop or Cursor at. The Go CLI in `apps/cli/` is the primary surface.
- **Teams that want shared memory.** They want multiple agents and humans to read/write the same brain, with auditable history, API key scoping, and tenant isolation. That is why the control schema has `Organization`, `OrganizationMembership`, and `ApiKey`, and every tenant schema has `BrainAccess` and `VaultChangeLog` (`prisma/control/schema.prisma`, `prisma/tenant/schema.prisma`).

The hosted tier at aju.sh exists so agents can use the platform without standing up Postgres + pgvector + S3 themselves. Everything the hosted tier does is also what you get when you self-host — same binary, same schema.

## Design principles

These are the invariants the codebase is built around. Every one has a matching tradeoff.

### 1. CLI-first, not UI-first

The primary interface is a single Go binary installed via `curl -fsSL install.aju.sh | sh` (`workers/install/src/index.ts:162-293`). The web app exists for signup, org management, and viewing data — not for daily use.

**Why.** Agents don't click buttons. A CLI that returns JSON is trivial to wrap as a tool; a web UI is not. The tradeoff is a steeper first-use curve for non-technical users.

### 2. Markdown is the storage format

Documents are stored as raw markdown text with YAML frontmatter. The server parses frontmatter into `VaultDocument.frontmatter` (JSON), extracts tags, resolves wikilinks, and keeps the original text verbatim in `content`. See `parseDocument` called from `src/app/api/vault/create/route.ts:52`.

**Why.** Markdown is the natural output of LLMs, the natural input for humans, and it diffs in git. The tradeoff is that we do not (and cannot) enforce a typed schema on document bodies — callers get what they write.

### 3. Tenant isolation is the database boundary

Every organization gets its own Postgres database inside a shared Neon project. Cross-org data is never visible in one query — the connection string only grants access to that org's DB. Inside a tenant DB, a second layer of RLS gates on `brain_id` via the session variable `app.current_brain_ids`, set by `withBrainContext` / `withTenant` in `src/lib/tenant-context.ts`. Policies live in `prisma/tenant/rls-policies.sql`.

**Why.** A single shared Postgres is a blast-radius magnet — one forgotten `AND organization_id = $1` and you leak across tenants. Putting the org boundary at the database level means cross-tenant leakage is physically impossible even with a buggy route. Brain-level RLS inside the tenant DB is defense-in-depth. The tradeoff is operational: every HTTP request has to resolve an org first, then route to the right tenant DB via `tenantDbFor(orgId)`.

### 4. Embeddings are eventual, not synchronous

`POST /api/vault/create` writes the row, then fires `updateDocumentEmbedding(doc.id)` without awaiting it (`src/app/api/vault/create/route.ts:94-96`). A cron endpoint and a standalone script exist to backfill anything that missed (`src/app/api/cron/backfill-embeddings/route.ts`, `scripts/backfill-embeddings.ts`).

**Why.** Voyage's embedding API is the slowest dependency on the write path — making it synchronous would couple every create to an external service's uptime. The tradeoff is a short window where a document exists but is not yet in the vector index; semantic search will miss it until the embedding lands.

### 5. One binary, many brains

A user can own multiple brains (personal, work, per-agent). Every API key is pinned to exactly one organization at mint time — the key's requests always route to that one org's tenant DB (`src/lib/auth.ts`, `src/app/api/keys/route.ts`). A single CLI install can target any brain in that org via `--brain <name>` or the `AJU_BRAIN` env var.

**Why.** The unit of memory is not the person, it is the task. Agents working on different projects should not share scratchpads by default. The tradeoff is extra resolution logic (`src/lib/brain.ts:resolveBrain`) on every request.

### 6. Open source, Apache 2.0

The repo is Apache 2.0, the CLI binary is distributed via GitHub releases, and the install script is a thin Cloudflare Worker that redirects to those releases (`workers/install/src/index.ts`). Self-hosting is a first-class path, documented at `/docs/self-host` in the app.

**Why.** Memory is too important to be locked to a vendor — agents outlive SaaS contracts. The tradeoff is that the hosted tier cannot rely on proprietary features to defend revenue; the value is operational (we run it for you) rather than capability-gated.
