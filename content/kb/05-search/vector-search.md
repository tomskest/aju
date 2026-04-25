---
title: Vector search
description: Voyage voyage-4-large embeddings, 1024-dim pgvector columns, HNSW cosine index, and the vector-only query mode.
order: 30
---

# Vector search

Full-text catches exact terms. Vector search catches paraphrase — "shipping
company crew travel" matches a doc titled "V.Group crew rotation logistics"
even if the two strings share no tokens. aju runs both and fuses them
(see [hybrid-rrf.md](./hybrid-rrf.md)); this page is about the vector leg.

## Provider and model

`src/lib/embeddings.ts:13`

```ts
const VOYAGE_API = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-4-large";
```

The provider is Voyage AI. The model is `voyage-4-large`, their flagship
general-purpose multilingual retrieval model. It outputs **1024**
dimensions — the single source of truth for that number is
`EMBEDDING_DIMENSIONS` in `src/lib/embeddings.ts:118`. The pgvector
column type in SQL must match, or inserts fail.

### Why Voyage and not OpenAI `text-embedding-3-small`

From the comment at `src/lib/embeddings.ts:4`:

> Chosen over OpenAI text-embedding-3-small for retrieval quality on
> developer/agent-memory corpora.

The corpus aju is tuned for is deliberately mixed: code-ish notes,
sales research, meeting minutes, frontmatter-heavy markdown. Voyage
benchmarks higher on MTEB retrieval tasks in that regime. The API
contract is close enough to OpenAI's that swapping back later is a
one-file change.

Platform-managed via `VOYAGE_API_KEY`. Per-org BYOK is on the roadmap
per the same comment block but not yet wired.

### `input_type` — document vs query

Voyage is an **asymmetric** embedding model. It offers an `input_type`
hint: `"document"` when embedding stored content, `"query"` at
retrieval time. Using the right one measurably improves retrieval
quality; get it backward and both sides end up in the "document"
region of the embedding space and never point at each other.

- Create / update / backfill paths pass `"document"`.
- The query paths in `/api/vault/semantic-search` and
  `/api/vault/deep-search` pass `"query"` explicitly:

```ts
// src/app/api/vault/semantic-search/route.ts:44
const queryEmbedding = await generateEmbedding(q, "query");
```

The default on `generateEmbedding` is `"document"`, matching the more
common write-side caller; retrieval paths must opt in to `"query"`.

### Truncation

```ts
// src/lib/embeddings.ts:15
const MAX_CHARS = 96000;
```

Voyage's context window is 32k tokens, roughly 4 chars per token, so
96k chars is a safe ceiling. Documents longer than that are truncated
from the head (take the first 96k, drop the rest). No chunking.

## Storage: the `embedding` column

`prisma/tenant/vector-setup.sql:9`

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE vault_files     ADD COLUMN IF NOT EXISTS embedding vector(1024);
```

Like the FTS column, this is added outside Prisma — Prisma 6 has no
first-class `vector` type — and applied per-tenant during provisioning
via `src/lib/tenant-provision.ts`. Each org's database gets its own
copy of the extension + index. Idempotent (`IF NOT EXISTS`), so re-runs
and redeploys are safe.

Nulls are permitted. A freshly-created document has `embedding = NULL`
until the fire-and-forget worker fills it in. The vector query path
filters them out (`WHERE embedding IS NOT NULL`), and the backfill
script picks them up.

### Vector literal encoding

pgvector accepts a literal like `'[0.123, -0.456, …]'::vector`. The app
builds that string with `toVectorLiteral`
(`src/lib/embeddings.ts:112`):

```ts
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
```

All writes use `$executeRawUnsafe` with `$1::vector` to cast the literal.

## Index: HNSW with cosine distance

```sql
-- prisma/tenant/vector-setup.sql:13
CREATE INDEX IF NOT EXISTS idx_vault_documents_embedding_hnsw
  ON vault_documents USING hnsw (embedding vector_cosine_ops);
```

HNSW (Hierarchical Navigable Small World) is pgvector's best-performing
ANN index for read-heavy workloads. Build time is slower than IVFFlat,
but query latency is lower and you don't need to pre-commit to a list
count that matches your row count.

`vector_cosine_ops` picks cosine distance as the similarity metric.
Voyage embeddings are already L2-normalised at the API layer, so cosine
and inner-product give the same ordering, but the op class also tells
pgvector which distance function to use internally.

## The pure-vector query

`src/app/api/vault/semantic-search/route.ts:46` (mode=`vector`):

```sql
SELECT id, path, title, section, doc_type, doc_status, tags, word_count,
       'document' AS source_type,
       1 - (embedding <=> $1::vector) AS similarity
FROM vault_documents
WHERE embedding IS NOT NULL
  AND brain_id = ANY($2::text[])
  AND 1 - (embedding <=> $1::vector) > $threshold
ORDER BY embedding <=> $1::vector
LIMIT $limit
```

Notes on the operators:

- `<=>` is pgvector's cosine **distance** (0 = identical, 1 =
  orthogonal, 2 = opposite).
- `similarity = 1 - distance`, the conventional cosine-similarity range
  (1 = identical, 0 = orthogonal).
- The ORDER BY uses the raw distance so HNSW can serve it directly.
  Computing `1 - (embedding <=> …)` in the SELECT is a display nicety
  and does not prevent index use.

The endpoint accepts a `threshold` param (default `0.0`, i.e. off).
Raising it to e.g. `0.5` drops weakly-related neighbours; useful when
the caller is going to feed results into an LLM and can't afford
noise.

## Why pure-vector mode exists at all

Given that hybrid RRF is the better default, why keep `mode=vector`?

- Debugging. When RRF results surprise you, re-running in pure-vector
  mode tells you whether the semantic side or the FTS side is
  responsible.
- Semantic-only corpora (e.g. code snippets where token overlap is
  misleading) can benefit from skipping FTS.
- It's essentially free — the vector CTE already runs inside RRF.

## What vector search does not do

- No re-ranking step. Top-K from the HNSW index is what the caller
  gets. A cross-encoder re-ranker (e.g. Voyage `rerank-2`) would fit
  naturally between the vector CTE and the response — not yet wired.
- No query expansion. The raw user query is embedded as-is.
- No per-field vectors. Only the combined (title + tags + body)
  document text is embedded. Title-only and tag-only vectors were
  considered; the one-vector-per-doc model keeps storage and query
  cost linear in corpus size.
