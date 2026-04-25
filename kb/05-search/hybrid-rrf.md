---
title: Hybrid ranking with Reciprocal Rank Fusion
description: The default search mode fuses FTS and vector ranks via RRF with k=60. How the SQL builds the two candidate sets and combines them.
order: 40
---

# Hybrid ranking with Reciprocal Rank Fusion

`/api/vault/semantic-search?mode=hybrid` is the production default. It
runs the full-text and the vector query in parallel, then merges their
ranked output using Reciprocal Rank Fusion (RRF).

## Why RRF

Two ranking signals with different score scales:

- **FTS rank** (`ts_rank`): unbounded, frequency-dependent, roughly
  0.001–0.5.
- **Vector similarity** (`1 - cosine_distance`): bounded 0–1, but cluster
  density and dimension can shift the useful range.

Naively summing them would let whichever signal happens to have the
larger scale drown out the other. Min-max normalisation is query-dependent
and unstable at small result counts. Learning a weighted blend requires
labels we don't have.

RRF sidesteps all of that. It throws away the scores entirely and uses
**only the ranks**. That makes it scale-free, order-preserving, and it
degrades gracefully when one side has zero hits.

The formula:

```
score(d) = Σ  1 / (k + rank_i(d))
         i∈indexes
```

where `rank_i(d)` is `d`'s position in index `i` (1-based), and `k` is a
constant. `k = 60` is the value introduced in the original RRF paper
(Cormack, Clarke, Büttcher 2009) and is what aju uses:

```ts
// src/app/api/vault/semantic-search/route.ts:112
const k = 60; // RRF constant
```

Higher `k` → flatter fusion, top ranks get less weight. `k = 60` strikes
a balance where rank 1 contributes roughly `1/61 ≈ 0.0164` and rank 50
contributes `1/110 ≈ 0.0091`.

## The hybrid query

One single SQL statement using three CTEs, bound to three parameters:
`$1` = query vector literal, `$2` = query string, `$3` = brain IDs. Any
extra filters append after.

```sql
WITH vector_results AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS vec_rank,
         1 - (embedding <=> $1::vector) AS similarity
  FROM vault_documents
  WHERE embedding IS NOT NULL
    AND brain_id = ANY($3::text[])
    -- plus optional section / doc_type filters
  ORDER BY embedding <=> $1::vector
  LIMIT 100
),
fts_results AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', $2)) DESC) AS fts_rank,
         ts_rank(search_vector, websearch_to_tsquery('english', $2)) AS fts_score
  FROM vault_documents
  WHERE search_vector @@ websearch_to_tsquery('english', $2)
    AND brain_id = ANY($3::text[])
    -- plus optional section / doc_type filters
  ORDER BY fts_score DESC
  LIMIT 100
),
combined AS (
  SELECT COALESCE(v.id, f.id) AS id,
         COALESCE(1.0 / (60 + v.vec_rank), 0)
         + COALESCE(1.0 / (60 + f.fts_rank), 0) AS rrf_score,
         v.similarity,
         f.fts_score AS fts_rank
  FROM vector_results v
  FULL OUTER JOIN fts_results f ON v.id = f.id
)
SELECT d.id, d.path, d.title, d.section, d.doc_type, d.doc_status,
       d.tags, d.word_count, 'document' AS source_type,
       c.similarity, c.fts_rank, c.rrf_score
FROM combined c
JOIN vault_documents d ON d.id = c.id
ORDER BY c.rrf_score DESC
LIMIT $limit
```

Source: `src/app/api/vault/semantic-search/route.ts:148`.

## Walkthrough

1. `vector_results` takes the top 100 documents by vector distance,
   stamping each with its `vec_rank` via `ROW_NUMBER()`. The HNSW index
   serves this in milliseconds.
2. `fts_results` takes the top 100 by `ts_rank`. The GIN index on
   `search_vector` serves this.
3. `combined` does a **FULL OUTER JOIN** on id. Three cases:
   - Hit in both → both `1/(60+rank)` terms contribute.
   - Hit only in vector → FTS term is `COALESCE(…, 0)`.
   - Hit only in FTS → vector term is `COALESCE(…, 0)`.
4. Final `SELECT` joins back to `vault_documents` for display fields
   and orders by descending `rrf_score`.

The top-K is computed from a pool of ≤200 candidates (100 per side,
minus overlap), which is more than sufficient given the typical caller
limit of 20.

## Cross-brain fusion

The `brain_id = ANY($3::text[])` filter in both CTEs is not only a
multi-brain admission gate — it is the whole reason RRF gives comparable
scores across brains. When the caller passes `brain=["a","b"]` or
`brain="all"`, documents from every requested brain compete in the same
vector top-100 and FTS top-100 pool. The fusion runs exactly once over
that unioned candidate set, so a result from brain A and a result from
brain B are ranked on identical footing.

This is the reason aju does not expose a per-brain search followed by a
client-side merge. Scores from two independent `ts_rank` calls or two
independent `1 - cosine_distance` values are not comparable — the ranks
within each query are, but only within that query's candidate ordering.
Fusing ranks across queries would give a fuzzy, lossy ranking. Doing the
union first and fusing once preserves the property RRF was chosen for.

The 100-per-side cap is still a hard ceiling on the candidate pool. When
a brain set is very large and relevant documents are distributed evenly
across brains, some tail hits may be truncated — but the 100 slots are
filled in rank order across the whole set, not split by brain, so the
top-K is still globally ordered.

## Pseudocode

```
inputs: query q, vector v = embed(q), k = 60, top = 100
vec  = order vault_documents by cosine(embedding, v) asc; take first 100
fts  = order vault_documents by ts_rank(search_vector, ws(q)) desc; take first 100

for each doc d in union(vec, fts):
    s = 0
    if d in vec: s += 1 / (k + rank_in(vec, d))
    if d in fts: s += 1 / (k + rank_in(fts, d))
    rrf[d] = s

return top limit by rrf score
```

## What gets returned

Each result carries the fused score plus both input signals so callers
can see why a document ranked:

```json
{
  "path": "06-Sales/Prospect-Profiles/Foo.md",
  "rrfScore": 0.03196,
  "similarity": 0.721,
  "ftsRank": 0.0284
}
```

The CLI falls back through them in order (`rrfScore`, else
`similarity`, else `rank`) to print a single sortable number — see
`client/cli/cmd/search.go:123`.

## Pool size and the `LIMIT 100` inside each CTE

Hard-coded to 100 per side today. Raising it has a cost: HNSW with
`ef_search` at its default does well for small K, and FTS `ts_rank`
over large candidate sets is where the GIN index stops helping. 100
was picked as "big enough that the fusion isn't starved, small enough
that p95 stays under 50ms on real corpora".

## Graceful degradation

- **No FTS hits** (rare terms, non-English corpus, etc.): the `combined`
  CTE still works because `v.id` comes through the left side of the
  FULL OUTER JOIN and the `f.fts_rank` coalesces to 0. Output is
  pure-vector order.
- **No vector hits** (embeddings not yet generated): same, reversed.
- **No hits on either side**: empty result set. No error.

## Not doing

- No learned ranker. RRF's strength is that it needs no training data.
- No cross-encoder re-rank. Would fit between the vector CTE and the
  JOIN but would add a Voyage round-trip to every query.
- No MMR (maximal marginal relevance) diversity. If two near-duplicate
  docs match strongly, both will rank high. For agent memory this is
  usually fine (the agent can dedup).

## Where hybrid RRF plugs into GraphRAG

`/api/vault/deep-search` (see
[knowledge-graph.md](./knowledge-graph.md#deep-search-graphrag) and
[search-surfaces.md](./search-surfaces.md)) uses the same hybrid RRF
query as its **seed stage**. It takes the top `seeds` (default 5) out
of the CTE above, then walks the wikilink graph 1–2 hops from those
seeds and re-ranks the resulting pool. Everything on this page about
RRF applies verbatim to how deep-search chooses which documents to
expand from.
