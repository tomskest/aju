import type { PrismaClient as PrismaClientTenant } from "@prisma/client-tenant";
import { Prisma } from "@prisma/client-tenant";
import {
  generateEmbeddings,
  prepareDocumentText,
  toVectorLiteral,
} from "@/lib/embeddings";
import { rebuildLinks } from "@/lib/vault";

export type ReindexOptions = {
  /**
   * Refresh every document, not just those with missing indexes. Useful after
   * changing the FTS trigger weights or the embedding model. Default: false.
   */
  refreshAll?: boolean;
  /** Run the FTS backfill. Default: true. */
  fts?: boolean;
  /** Run the embedding backfill. Default: true. */
  embeddings?: boolean;
  /** Rebuild the wikilink graph. Default: true. */
  links?: boolean;
};

export type ReindexResult = {
  ftsRefreshed: number;
  embeddingsGenerated: number;
  embeddingsFailed: number;
  links?: { documents: number; resolved: number; unresolved: number };
  durationMs: number;
};

/**
 * Voyage accepts up to 128 texts per call; 100 keeps us safely under that
 * and matches scripts/backfill-embeddings.ts.
 */
const EMBEDDING_BATCH_SIZE = 100;

/**
 * Repopulate derived indexes for a brain:
 *   1. FTS search_vector — force the trigger to fire for rows inserted
 *      before the trigger existed (or rewritten if refreshAll).
 *   2. Voyage embeddings — generate for rows where embedding IS NULL.
 *   3. Wikilink graph — full rebuild via rebuildLinks().
 *
 * Scoped to a single brainId within one tenant DB. Idempotent.
 */
export async function reindexBrain(
  tenant: PrismaClientTenant,
  brainId: string,
  opts: ReindexOptions = {},
): Promise<ReindexResult> {
  const { refreshAll = false, fts = true, embeddings = true, links = true } = opts;
  const start = Date.now();

  let ftsRefreshed = 0;
  let embeddingsGenerated = 0;
  let embeddingsFailed = 0;
  let linksResult: ReindexResult["links"];

  if (fts) {
    const ftsCondition = refreshAll
      ? Prisma.sql`brain_id = ${brainId}`
      : Prisma.sql`brain_id = ${brainId} AND search_vector IS NULL`;
    const res = await tenant.$executeRaw`
      UPDATE vault_documents SET synced_at = NOW() WHERE ${ftsCondition}
    `;
    ftsRefreshed = Number(res);
  }

  if (embeddings) {
    const embeddingCondition = refreshAll
      ? Prisma.sql`brain_id = ${brainId}`
      : Prisma.sql`brain_id = ${brainId} AND embedding IS NULL`;
    const docs = await tenant.$queryRaw<
      Array<{ id: string; title: string; tags: string[]; content: string }>
    >`
      SELECT id, title, tags, content FROM vault_documents WHERE ${embeddingCondition}
    `;

    for (let i = 0; i < docs.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = docs.slice(i, i + EMBEDDING_BATCH_SIZE);
      const texts = batch.map((d) =>
        prepareDocumentText(d.title, d.tags, d.content),
      );
      try {
        const vectors = await generateEmbeddings(texts);
        for (let j = 0; j < batch.length; j++) {
          const vector = toVectorLiteral(vectors[j]);
          const id = batch[j].id;
          await tenant.$executeRaw`
            UPDATE vault_documents SET embedding = ${vector}::vector WHERE id = ${id}
          `;
        }
        embeddingsGenerated += batch.length;
      } catch (err) {
        embeddingsFailed += batch.length;
        console.error(
          `Reindex embedding batch failed (brain=${brainId}, size=${batch.length}):`,
          err,
        );
      }
    }
  }

  if (links) {
    linksResult = await rebuildLinks(tenant, brainId);
  }

  return {
    ftsRefreshed,
    embeddingsGenerated,
    embeddingsFailed,
    links: linksResult,
    durationMs: Date.now() - start,
  };
}
