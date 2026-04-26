---
title: Embedding pipeline
description: When documents become searchable. Fire-and-forget inline embedding, the cron backfill, and the lack of a persistent job queue.
order: 50
---

# Embedding pipeline

Every document and every uploaded file that contains text needs an
embedding before the vector leg of search can find it. aju takes the
simplest possible approach: embed inline after a write, skip on
failure, and let a backfill endpoint catch up later.

No Redis queue, no BullMQ, no Temporal. The reason is covered in the
overview: aju's target deploys are single-region single-Postgres, and
the write rates are measured in "a few per hour" not "a few per
second". A persistent job queue would be complexity without a payoff.

## The write path

Every mutation that changes embeddable content fires
`updateDocumentEmbedding` or `updateFileEmbedding` **outside** the DB
transaction that recorded the mutation, and **without awaiting** the
promise.

### Create

```ts
// src/app/api/vault/create/route.ts (post-commit)
updateDocumentEmbedding(tenant, created.id).catch((err) =>
  console.error("Embedding after create failed:", err)
);
```

### Update

```ts
// src/app/api/vault/update/route.ts (post-commit)
updateDocumentEmbedding(tenant, existing.id).catch((err) =>
  console.error("Embedding after update failed:", err)
);
```

Both `tenant` clients here come from the surrounding `withTenant({
organizationId, userId })` scope — `updateDocumentEmbedding` needs a
tenant Prisma client because the `vault_documents` table lives only in
tenant DBs, not in the control plane.

### File upload

The file-upload route and its `confirm-upload` sibling for presigned-URL
uploads extract text from PDFs and text/* MIME types via
`extractText(buffer, mimeType)`, write the file row with
`tx.vaultFile.create`, then fire-and-forget
`updateFileEmbedding(tenant, created.id)`.

### What "fire-and-forget" means here

- The HTTP response returns immediately after the transaction commits.
  The caller sees their document as created and searchable via FTS.
- The embedding call runs in the background on the same Node process.
  If the process restarts (e.g. a new deploy lands) before the Voyage
  call returns, the embedding is lost — but the document row still
  has `embedding = NULL` and the backfill will catch it.
- Errors are logged, never surfaced. An agent asking "did my write
  succeed?" will get yes even if the embedding part silently failed.
  Acceptable because FTS still works; only semantic/hybrid search is
  degraded, and only until the next backfill.

**Why not `await`:** the Voyage API call costs 100–300ms. Blocking the
write path on it would triple the perceived latency of every note
save. Put another way: aju prefers eventual consistency on the vector
index and strong consistency on the document body.

## The embed function

`src/lib/update-embedding.ts:9`

```ts
export async function updateDocumentEmbedding(
  tenant: PrismaClientTenant,
  documentId: string,
): Promise<void> {
  const doc = await tenant.vaultDocument.findUnique({
    where: { id: documentId },
    select: { id: true, title: true, tags: true, content: true },
  });
  if (!doc) return;

  const text = prepareDocumentText(doc.title, doc.tags, doc.content);
  const embedding = await generateEmbedding(text);
  const vector = toVectorLiteral(embedding);

  await tenant.$executeRawUnsafe(
    `UPDATE vault_documents SET embedding = $1::vector WHERE id = $2`,
    vector,
    doc.id,
  );
}
```

Four steps:

1. Re-read the row against the tenant client. The document might have
   been updated again between the dispatch and this lookup; the latest
   content is what matters. No control-plane client is involved — the
   `vault_documents` table doesn't live there.
2. Build the embedding text via `prepareDocumentText`
   (`src/lib/embeddings/embeddings.ts:28`). Strips YAML frontmatter, then joins
   `[title, tags.join(", "), body]` with blank lines. The title gets
   put first deliberately — it's the strongest signal about what the
   document *is*, and Voyage's bag-of-context pooling still weights
   early tokens slightly more.
3. Call Voyage with `input_type="document"` (the default on
   `generateEmbedding`). Synchronous, no retry.
4. Update the row via `tenant.$executeRawUnsafe`. Raw exec is needed
   because Prisma can't cast to the `vector` type.

Callers pass the tenant client in. API routes and MCP tools already
have one from `withTenant({ organizationId, userId })`; the backfill
script builds one explicitly via `tenantDbFor(orgId)` per iteration.

## Document vs query embeddings

Voyage is **asymmetric**: the same text produces a different vector
depending on whether you call it with `input_type="document"` or
`input_type="query"`. Mixing the two degrades retrieval — documents
cluster in one region of the space, queries in another, and cosine
similarity between a "document"-encoded query and a "document"-encoded
doc is subtly worse than the correct pairing.

The split in aju:

| Path | `input_type` | Where |
|---|---|---|
| `updateDocumentEmbedding` (write) | `"document"` | `src/lib/update-embedding.ts` |
| `updateFileEmbedding` (write) | `"document"` | `src/lib/update-embedding.ts` |
| Backfill cron / script | `"document"` | `src/app/api/cron/backfill-embeddings/route.ts` |
| `/api/vault/semantic-search` | `"query"` | `route.ts:44` |
| `/api/vault/deep-search` (seed embedding) | `"query"` | `route.ts:57` |

`generateEmbedding(text)` defaults to `"document"` because the
write-side is the more common caller; every retrieval path opts in to
`"query"` explicitly.

## Idempotency

No explicit dedup. If `updateDocumentEmbedding(id)` gets called three
times concurrently (three quick updates), three Voyage calls happen,
the last `UPDATE` wins. Unnecessary but harmless. The Voyage bill
sees three requests instead of one; not worth the coordination code
at current write rates.

## Retry and backoff

None. `generateEmbedding` throws; the caller's `.catch()` logs; the
row is left with a stale or null embedding.

The recovery mechanism is the backfill:

## Backfill endpoint

`src/app/api/cron/backfill-embeddings/route.ts`. Wraps the fill work in
`withTenant({ organizationId })` so the `SELECT` and `UPDATE` run
against the right per-org tenant DB. The query body looks like:

```ts
// inside withTenant, against `tx`
const docs = await tx.$queryRawUnsafe(
  `SELECT id, title, tags, content FROM vault_documents WHERE embedding IS NULL`
);

for (let i = 0; i < docs.length; i += BATCH_SIZE) {
  const batch = docs.slice(i, i + BATCH_SIZE);
  const texts = batch.map(d => prepareDocumentText(d.title, d.tags, d.content));
  const embeddings = await generateEmbeddings(texts);  // one batched API call
  for (let j = 0; j < batch.length; j++) {
    await tx.$executeRawUnsafe(
      `UPDATE vault_documents SET embedding = $1::vector WHERE id = $2`,
      toVectorLiteral(embeddings[j]), batch[j].id
    );
  }
}
```

`BATCH_SIZE = 100` (`route.ts:12`). That's inside Voyage's batch limit
and small enough to keep the per-request payload under a megabyte.

The endpoint is behind `authenticate()`. Trigger via the cron scheduler
or the admin dashboard; the heavier work is available locally via
`npm run backfill:embeddings` which runs `scripts/backfill-embeddings.ts`.

Optional `?brain=<name>` scopes the backfill to one brain within the
caller's org; without it, every brain in the caller's tenant DB.

### Backfill script (loops every active tenant)

`scripts/backfill-embeddings.ts` is the bulk cross-org version. It
iterates every active tenant from the control plane and opens a
per-tenant client for each:

```ts
const tenants = await control.tenant.findMany({
  where: { status: "active" },
  select: { organizationId: true },
});

for (const t of tenants) {
  const tenant = await tenantDbFor(t.organizationId);
  await backfillDocuments(tenant, t.organizationId);
  await backfillFiles(tenant, t.organizationId);
}
```

(`scripts/backfill-embeddings.ts:102-134`.) Each `backfillDocuments` /
`backfillFiles` function runs raw `$queryRawUnsafe` / `$executeRawUnsafe`
against the tenant client for that org, so one run drains every tenant
DB in sequence. Use it when:

- You've bulk-imported vaults and don't want to drive traffic through
  the deployed HTTP surface.
- You're swapping embedding models (run after changing
  `EMBEDDING_DIMENSIONS` + re-creating the `vector(N)` column across
  every tenant's schema).
- You've onboarded a new region or restored a tenant and want to fill
  gaps without per-tenant curl invocations.

Failures are logged per-tenant and don't stop the loop — the final
line prints `tenants=N failed=F docs=D files=F` so you know how many
DBs still have null embeddings.

## File embeddings

Same shape, different preparation:

```ts
// src/lib/embeddings/embeddings.ts:41
export function prepareFileText(filename, tags, extractedText) {
  const parts = [filename];
  if (tags.length > 0) parts.push(tags.join(", "));
  if (extractedText) parts.push(extractedText);
  return parts.join("\n\n");
}
```

Files are only embedded if `extractedText` is non-null. A PNG image
with no caption has no text to embed, and you'll never get it back
from semantic search — you'd reach for it by category or tag instead.

## Chunking (not)

aju does not chunk. One document → one embedding. At 96k chars max,
the full body fits. The tradeoff is that very long documents dilute
their own top-k matches: the embedding is an average of the whole
thing, so a short relevant passage inside a 50-page PDF competes on
even terms with a tightly-focused 500-word note. Fine for human notes;
not fine for long-form technical documents. Chunking with passage-
level vectors is on the roadmap.

## Observability

- Failures are `console.error`'d. No structured logging yet.
- The backfill endpoint returns `{ docsProcessed, filesProcessed,
  docsSkipped, filesSkipped, durationMs }` so a cron job's logs tell
  you how far behind you are.
- There's no "embedding pending" flag on documents. If you want to
  audit, query `SELECT count(*) FROM vault_documents WHERE embedding
  IS NULL`.
