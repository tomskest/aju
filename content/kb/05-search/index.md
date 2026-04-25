---
title: Search, retrieval, and the knowledge graph
description: How aju finds things — full-text, vectors, hybrid RRF, and the wikilink graph layered on top.
order: 10
---

# Search, retrieval, and the knowledge graph

Retrieval is the reason aju exists. An agent asks a question; aju returns
the subset of its own past notes that are most likely to help. Three
indexes sit behind that answer:

1. **Postgres full-text search** over `title`, `tags`, and `content`
   (`search_vector` tsvector + GIN index). Good at exact terms, names,
   and rare tokens.
2. **pgvector cosine similarity** over 1024-dimensional Voyage embeddings
   (one vector per document, HNSW-indexed). Good at paraphrase and
   conceptual overlap.
3. **A wikilink graph** (`document_links`) materialised from `[[…]]`
   references inside the markdown. Not a search index by itself, but the
   thing that lets "deep search" and the "related" tool walk neighbours.

The default endpoint — `/api/vault/semantic-search?mode=hybrid` — fuses
(1) and (2) with Reciprocal Rank Fusion. The "deep search" endpoint does
that *and then* expands through (3) to pull in graph-neighbour documents.

## Design posture

- **No chunking.** Each document produces exactly one embedding of its
  full body (truncated to 96k chars for Voyage's 32k-token window). See
  `src/lib/embeddings.ts:15`. Chunking was considered; for the target
  corpus (human-written notes, usually <10k tokens) whole-doc retrieval
  preserves context at the cost of some precision on very long docs.
- **Everything is Postgres.** No Elasticsearch, no dedicated vector DB,
  no separate graph DB. FTS is native, pgvector is a Postgres extension,
  the "graph" is one table with two foreign keys. Operational simplicity
  is the win; if you outgrow it, the data model is straightforward to
  re-host.
- **One Postgres database per organization.** The vault tables
  (`vault_documents`, `document_links`, `vault_files`, …) live in
  per-tenant databases provisioned via `src/lib/tenant-provision.ts`;
  route handlers reach the right DB via `tenantDbFor(orgId)` in
  `src/lib/db.ts`. The DB boundary IS the org boundary; there are no
  `organization_id` columns on the tenant tables themselves.
- **Fire-and-forget embedding.** `/api/vault/create` and
  `/api/vault/update` write the document in a tenant transaction (opened
  via `withTenant`), then kick off `updateDocumentEmbedding(tenant, id)`
  without awaiting it. The write succeeds even if Voyage is down; a
  later backfill job picks up the stragglers.
- **Brain-scoped by default.** Every search query takes `brain_id =
  ANY($…)` so results can't leak across brains inside the same org.
  Row-Level Security in each tenant DB adds a second fence, gating on
  `brain_id` via the `app.current_brain_ids` session variable set by
  `withBrainContext` / `withTenant` in `src/lib/tenant-context.ts` at
  the top of every request transaction.

## What's in this section

1. [full-text-search.md](./full-text-search.md) — tsvector triggers,
   weighted columns, websearch syntax, the GIN and trigram indexes.
2. [vector-search.md](./vector-search.md) — Voyage `voyage-4-large`,
   why 1024 dims, `vector(1024)` storage, HNSW cosine index, pure-vector
   mode.
3. [hybrid-rrf.md](./hybrid-rrf.md) — the RRF query, `k=60`, why rank
   fusion beats score normalisation, what the top-100 cap means.
4. [embedding-pipeline.md](./embedding-pipeline.md) — when embeddings
   are generated, how retries work (they don't — the backfill picks up
   gaps), `input_type=document|query`, batch sizes.
5. [knowledge-graph.md](./knowledge-graph.md) — wikilink parsing, the
   basename resolver, full-rebuild strategy, the graph expansion in
   deep search, backlinks/related/neighbors endpoints.
6. [search-surfaces.md](./search-surfaces.md) — what the CLI exposes
   (`aju search`, `aju semantic`, `aju deep-search`, `aju backlinks`,
   `aju related`, `aju graph`), the `aju_*` MCP tools that back the
   remote endpoint, and the absence of a web UI search surface (by
   design, today).

## Reading order

Start with `full-text-search.md` and `vector-search.md` — they are the
two independent retrieval axes. Then read `hybrid-rrf.md`, which is
the production default. `embedding-pipeline.md` and `knowledge-graph.md`
are about the write-side plumbing that keeps the indexes alive.
`search-surfaces.md` is for anyone integrating with aju externally.
