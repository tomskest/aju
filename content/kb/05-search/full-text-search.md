---
title: Full-text search
description: tsvector, GIN indexes, trigger-maintained columns, and the websearch query syntax wired into /api/vault/search.
order: 20
---

# Full-text search

aju uses Postgres's native full-text search. No external search service,
no sidecar indexer. The index lives next to the data, updates atomically
with every write, and is queried by every `aju search` call.

## The tsvector column

The search column is *not* a Prisma field — Prisma's schema language
cannot express the expression we need — so it's created out-of-band by
`prisma/tenant/fts-setup/migration.sql`, applied per-tenant during
provisioning (`src/lib/tenant-provision.ts`) and again on tenant
migrations.

```sql
-- prisma/tenant/fts-setup/migration.sql:4
ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS search_vector tsvector;
```

The column is **not** a Postgres `GENERATED` column. That was the first
choice and it had to be backed out: generated columns cannot reference
array-valued expressions like `array_to_string(tags, ' ')`, which we need
to index tags inline. A trigger is the portable workaround.

```sql
-- prisma/tenant/fts-setup/migration.sql:7
CREATE OR REPLACE FUNCTION vault_documents_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vault_documents_search
  BEFORE INSERT OR UPDATE ON vault_documents
  FOR EACH ROW EXECUTE FUNCTION vault_documents_search_update();
```

Three weight classes:

| Weight | Field | Intent |
|---|---|---|
| A | `title` | Heaviest — exact title hits dominate ranking. |
| B | `tags` | Authorial signal: the user explicitly tagged this doc. |
| C | `content` | Body. Everything else. |

`to_tsvector('english', …)` applies Snowball English stemming and the
default English stop-word list. That's the only supported language
today; a second configuration for multilingual corpora is TODO and would
require per-document language detection.

**Why BEFORE INSERT/UPDATE on every row:** the tsvector is always in
sync with the row, the index never drifts, and there's no backfill to
run after a code change that rewrites the function body. The tradeoff
is a small CPU cost on every write, which is irrelevant for the target
write rates.

## The GIN index

```sql
-- prisma/tenant/fts-setup/migration.sql:23
CREATE INDEX IF NOT EXISTS idx_vault_documents_search
  ON vault_documents USING gin(search_vector);
```

GIN is the right choice for `@@ tsvector`. It's slower to build and
bigger on disk than GiST, but `@@` lookups are substantially faster,
which matters for interactive search.

## Fuzzy title match (trigram)

```sql
-- prisma/tenant/fts-setup/migration.sql:26
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_vault_documents_title_trgm
  ON vault_documents USING gin(title gin_trgm_ops);
```

Not currently wired into the query path. The infrastructure is in place
for typo-tolerant title matches (e.g. for an autocomplete surface) but
no endpoint uses `title % 'foo'` yet. TODO: verify whether this is
reserved for a future autocomplete.

## The same setup for `vault_files`

`prisma/tenant/fts-setup/files-fts.sql` mirrors the document setup
against `vault_files`, with `filename` getting weight A, `tags` B, and
`extracted_text` C. Applied per-tenant alongside the document FTS
setup. PDFs and text/* MIME types get their bodies extracted by
`src/lib/extract-text.ts` and then become searchable just like markdown
documents.

## The search endpoint

`src/app/api/vault/search/route.ts` is a single GET that takes `q` plus
optional filters (`section`, `type`, `status`, `limit`). It runs one
raw SQL statement that UNIONs documents and files.

The core query (simplified from `route.ts:109`):

```sql
SELECT
  id, path, title, section, doc_type, doc_status, tags, word_count,
  'document' AS source_type, NULL AS mime_type,
  ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank,
  ts_headline('english', content, websearch_to_tsquery('english', $1),
    'StartSel=<<, StopSel=>>, MaxWords=60, MinWords=20, MaxFragments=3'
  ) AS snippet
FROM vault_documents
WHERE search_vector @@ websearch_to_tsquery('english', $1)
  AND brain_id = ANY($2::text[])
  -- plus optional: section, doc_type, doc_status filters
UNION ALL
SELECT id, s3_key AS path, filename AS title, … AS rank, ts_headline(…) AS snippet
FROM vault_files
WHERE search_vector @@ websearch_to_tsquery('english', $1)
  AND extracted_text IS NOT NULL
  AND brain_id = ANY($2::text[])
ORDER BY rank DESC
LIMIT $3
```

### Why `websearch_to_tsquery`

Three tsquery parsers exist in Postgres: `to_tsquery` (strict, requires
operators), `plainto_tsquery` (every word AND), and
`websearch_to_tsquery` (accepts Google-ish syntax: quoted phrases, `-`
for negation, `OR`). The last one is what users expect from a search
box, and it never throws on malformed input — important when the query
is agent-generated.

### Why `ts_rank` (not `ts_rank_cd`)

`ts_rank` rewards frequency of match terms; `ts_rank_cd` rewards
proximity/cover density. For agent memory, frequency is the better
proxy — a doc that mentions "Hamburg" ten times is more likely "about
Hamburg" than one where "Hamburg" happens to sit two words from another
query term. This could become a knob later.

### File vs document filter behaviour

Files are only included in results when no document-specific filter is
set (`section`, `type`, or `status`). See
`src/app/api/vault/search/route.ts:74`. The rationale: those filter
columns don't exist on `vault_files`, so mixing them would silently
drop the entire file side of the UNION — better to be explicit.

### Snippets

`ts_headline` produces `<<highlighted>>` fragments with the matching
terms wrapped. The CLI strips these to one line; the MCP pass-through
hands them to the LLM verbatim so the agent can quote them back.

## Ranking characteristics

- Out-of-the-box `ts_rank` returns values in roughly 0.0–1.0, with most
  interesting hits between 0.01 and 0.1. It is **not** comparable
  across queries — the scale depends on document length and term
  frequency. The CLI prints it as a four-digit decimal for diagnostic
  value only.
- No query-time boost for recency. If you want the freshest doc on top,
  filter by `section` or sort client-side.
