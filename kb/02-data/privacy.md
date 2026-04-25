---
title: Privacy posture
description: What data leaves your machine, where it's stored, and what the embedding provider sees.
order: 80
---

# Privacy posture

This page is a map of every place aju's bytes go and why.

## What leaves your machine

When you run the CLI (`aju write`, `aju files upload`, ...) or use the web
UI, your content travels to the aju server over HTTPS and lands in one of
two stores:

- **Postgres (Neon)** — structured data and text. Split across two planes:
  one control DB (identity, orgs, keys), and one tenant DB per org
  (brains, documents, files metadata).
- **R2 (or any S3-compatible bucket)** — binary file contents.

That's the whole list of stores aju itself operates. One third party sees
a subset of the text: **Voyage AI**, for embedding generation.

## What Postgres stores

Every field described in [schema.md](./schema.md). Specifically, the
privacy-sensitive columns — split by which database they live in:

**Per-org tenant DB (`org_<cuid>`):**

| Table | Sensitive columns |
|---|---|
| `vault_documents` | `content` (full markdown), `frontmatter`, `title`, `tags`, `wikilinks` |
| `vault_files` | `filename`, `extracted_text`, `metadata`, `uploaded_by` |
| `vault_change_log` | `path`, `changed_by`, `source`, `actor_id` |

**Control DB (`aju_control`):**

| Table | Sensitive columns |
|---|---|
| `user` | `email`, `name`, `image` |
| `session` | `ip_address`, `user_agent` |
| `account` | OAuth tokens (`access_token`, `refresh_token`, `id_token`, `password` hashes) |
| `api_key` | `prefix` (plaintext), `hash` (scrypt hash) |
| `device_code` | `api_key_plaintext` — briefly, until the CLI collects it |
| `tenant` | `dsn_direct_enc`, `dsn_pooled_enc` — AES-GCM-encrypted per-org DSNs |

Cross-org data is physically separated at the database level. An
authenticated request to one org's tenant DB cannot query another org's
tenant DB — the connection string doesn't grant access. See
[tenant-isolation.md](./tenant-isolation.md) for the full isolation model.

Postgres is the ground truth. Nothing structured exists outside it.

## What R2 stores

**Only** the raw bytes of uploaded files, under keys shaped like
`<brainName>/files/<category>/<filename>`. The S3 client lives at
`src/lib/s3.ts`. Access is via presigned URLs (1h expiry by default) or
the server's AWS credentials for internal operations.

R2 does not see:

- Your markdown documents — those live in Postgres, never in object
  storage.
- Any parsed metadata — filename is in the key, but categories, tags,
  extracted text, and the mime type are stored in `vault_files`, not as
  S3 object metadata.

Encryption at rest is R2's responsibility (and is enabled by default for
all R2 buckets).

## What the embedding provider sees

`src/lib/embeddings.ts`. aju sends text to **Voyage AI** to produce
retrieval embeddings.

- Provider: `voyageai` (`EMBEDDING_PROVIDER` constant).
- Model: `voyage-4-large` (1024 dims, cosine similarity).
- Endpoint: `https://api.voyageai.com/v1/embeddings`.
- Auth: `VOYAGE_API_KEY` env var on the server.

### What gets sent

For **documents** (`prepareDocumentText`,
`src/lib/embeddings.ts:28`):

```
<title>

<tags joined by ", ">

<body with frontmatter YAML stripped>
```

The YAML frontmatter block is removed before sending, because frontmatter
is metadata that shouldn't influence semantic ranking.

For **files** (`prepareFileText`, `src/lib/embeddings.ts:41`):

```
<filename>

<tags joined by ", ">

<extractedText>
```

Only the **extracted plain text** ships — the actual PDF / image bytes
never leave aju's infrastructure. Files without extractable text (images,
binaries) are never sent to Voyage at all.

### Truncation

Voyage's context is 32K tokens; aju truncates input at 96,000 characters
(`MAX_CHARS`, `src/lib/embeddings.ts:15`) as a ~4 chars/token safe margin.
Long documents are silently truncated at the tail.

### Input-type hint

`input_type` is set to `"document"` for stored content and `"query"` for
semantic-search queries. Using the right one measurably improves retrieval
quality per Voyage's docs (`src/lib/embeddings.ts:20`).

### Why Voyage

Per the top-of-file comment (`src/lib/embeddings.ts:1`):

> Chosen over OpenAI text-embedding-3-small for retrieval quality on
> developer/agent-memory corpora. voyage-4-large is Voyage's flagship
> general-purpose multilingual retrieval model. Platform-managed via env
> var VOYAGE_API_KEY; later we layer BYOK on top (per-org provider keys).

BYOK (bring-your-own-key per-org Voyage credentials) is noted as a future
direction but not implemented today.

## What does NOT get sent to third parties

- **Anthropic / OpenAI** — no LLM calls are made from the aju backend.
  LLMs are orchestrated on the agent side (the MCP client, the CLI, or
  your own agent). aju is a memory store, not a model runtime.
- **Analytics trackers** — the server doesn't ship document content to
  any analytics provider.
- **Email providers** — transactional email (verifications, invites)
  goes through whichever SMTP / API provider is configured in
  `src/lib/email.ts`; that provider sees the email address and the
  subject/body of the transactional message, not vault content.

## API-key hygiene

`ApiKey.prefix` is the first 12 characters of the plaintext. Shown once on
creation, stored plaintext for lookup. The **rest** is scrypt-hashed
(`<salt-hex>:<hash-hex>`) so a DB read cannot recover the full key
(`data/control/schema.prisma`). Every key is also pinned to exactly one
organization at mint time — a leaked key's blast radius is capped to one
org's tenant DB.

`DeviceCode.apiKeyPlaintext` is the one place a full key sits at rest — as
a transient intermediate in the CLI login flow. It's populated when the
user approves a login, fetched once by the CLI, and should be cleared by
the client on retrieval. **This is a documented short window.**

## Session data

`Session` stores `ipAddress` and `userAgent` for audit. Better-Auth's
session expiry handles natural cleanup; no separate retention policy is
applied.

## Embeddings storage

Embeddings live alongside the row they describe, in each tenant DB, on
`vault_documents` and `vault_files`, as `vector(1024)` columns. HNSW
indexes power cosine-sim queries (`data/tenant/vector-setup.sql`).
Embeddings never leave the tenant database once written — semantic search
happens in-database, within the same org's DB.

## Deletion and residual data

Deletion is real end-to-end — both the DB rows **and** the R2 bytes go.

- **Brain delete** (`DELETE /api/brains/[id]`) enumerates every
  `VaultFile.s3Key` for the brain from the tenant DB and batch-deletes
  those objects from R2 (up to 1000 keys per `DeleteObjectsCommand`)
  *before* dropping the `Brain` row. See
  [export-and-deletion.md](./export-and-deletion.md) for the exact
  sequence and failure semantics.
- **Account delete** (`DELETE /api/me/delete`) walks every org the user
  owns and runs `deleteOrganizationWithStorage`: wipe each brain's R2
  objects, evict cached tenant clients, call `destroyTenant` (Neon API
  drops the DB + role + deletes the tenant row), then delete the org row.
  Then drops the user's memberships in other orgs, deletes the `User` row
  (cascading sessions, api keys, accounts), and clears cookies.
  Idempotent at every step.
- **Voyage AI embeddings** — aju does not call a Voyage delete endpoint.
  Voyage's stateless embedding API retains only what its own privacy
  policy describes; aju's local embeddings are stored on the tenant DB's
  `vault_documents` / `vault_files` rows and are removed by the tenant
  DB drop above.
- **Transactional email** — already delivered by the configured provider
  at send time; there's nothing aju can recall.

## Summary

- Postgres: everything structured, split between a shared control DB and
  one dedicated tenant DB per organization.
- R2: binary file bytes only, keyed by human-readable brain path.
- Voyage AI: text (title + tags + body or extracted text) for embedding.
- No other third party sees content.
- Users can pull a full copy via `/api/me/export` at any time.
- Brain delete wipes DB rows **and** R2 objects. Account delete
  (`/api/me/delete`) drops every owned org's entire tenant database
  (Neon API) plus the R2 objects, then deletes the user row.
