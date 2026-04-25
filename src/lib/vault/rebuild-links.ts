import type { PrismaClient as PrismaClientTenant } from "@prisma/client-tenant";
import { buildBasenameMap, resolveLinks } from "@/lib/vault";

export type RebuildLinksResult = {
  documents: number;
  resolved: number;
  unresolved: number;
};

/**
 * Rebuild the document link graph from wikilinks stored in the tenant DB.
 * Full delete + recreate — fast for ~300 docs (~1-2s).
 *
 * @param tenant - The tenant Prisma client (scoped to one org's database).
 * @param brainId - When provided, only rebuild links for documents in that
 *                  brain. When omitted, rebuild every brain in the tenant.
 *
 * Wraps the delete+insert sweep in a transaction and a per-brain Postgres
 * advisory lock so concurrent rebuilds serialize instead of deadlocking on
 * `document_links`. Fire-and-forget callers on the create/update/delete
 * paths should go through `scheduleRebuildLinks` to additionally collapse
 * bursts into a single follow-up run.
 */
export async function rebuildLinks(
  tenant: PrismaClientTenant,
  brainId?: string,
): Promise<RebuildLinksResult> {
  return tenant.$transaction(
    async (tx) => {
      const lockKey = `rebuild-links:${brainId ?? "__all__"}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))`;

      const docWhere = brainId ? { brainId } : {};

      const allDocs = await tx.vaultDocument.findMany({
        where: docWhere,
        select: { id: true, path: true, wikilinks: true, brainId: true },
      });

      const allPaths = allDocs.map((d) => d.path);
      const allPathsSet = new Set(allPaths);
      const pathToId = new Map(allDocs.map((d) => [d.path, d.id]));
      const basenameMap = buildBasenameMap(allPaths);

      if (brainId) {
        await tx.documentLink.deleteMany({ where: { brainId } });
      } else {
        await tx.documentLink.deleteMany({});
      }

      // Collect every resolved link across every doc into one buffer, then
      // issue a single createMany. Prisma chunks internally to stay under
      // Postgres' parameter cap, so we don't need to slice manually here.
      const linkBuffer: Array<{
        sourceId: string;
        targetId: string;
        linkType: string;
        linkText: string;
        brainId: string;
      }> = [];
      let totalResolved = 0;
      let totalUnresolved = 0;

      for (const doc of allDocs) {
        if (doc.wikilinks.length === 0) continue;

        const { resolved, unresolved } = resolveLinks(
          doc.wikilinks,
          doc.path,
          allPathsSet,
          basenameMap,
        );

        totalResolved += resolved.length;
        totalUnresolved += unresolved.length;

        for (const link of resolved) {
          const targetId = pathToId.get(link.targetPath);
          if (!targetId) continue;
          linkBuffer.push({
            sourceId: doc.id,
            targetId,
            linkType: "wikilink",
            linkText: link.linkText,
            brainId: doc.brainId,
          });
        }
      }

      if (linkBuffer.length > 0) {
        await tx.documentLink.createMany({
          data: linkBuffer,
          skipDuplicates: true,
        });
      }

      return {
        documents: allDocs.length,
        resolved: totalResolved,
        unresolved: totalUnresolved,
      };
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}

const inflight = new Map<string, Promise<RebuildLinksResult>>();
const needsRerun = new Set<string>();

/**
 * Single-flight wrapper for fire-and-forget rebuilds triggered by
 * create/update/delete. If a rebuild for `brainId` is already running,
 * flag a follow-up pass and return the in-flight promise. A burst of N
 * mutations collapses into at most two sequential rebuilds — the one
 * in flight plus one that captures anything committed during it.
 *
 * Process-local (Map). Under multi-replica deployments, coalescing only
 * helps within a replica; the advisory lock in `rebuildLinks` still
 * guarantees correctness across replicas.
 */
export function scheduleRebuildLinks(
  tenant: PrismaClientTenant,
  brainId: string,
): Promise<RebuildLinksResult> {
  const running = inflight.get(brainId);
  if (running) {
    needsRerun.add(brainId);
    return running;
  }
  const p = (async () => {
    try {
      return await rebuildLinks(tenant, brainId);
    } finally {
      inflight.delete(brainId);
      if (needsRerun.delete(brainId)) {
        scheduleRebuildLinks(tenant, brainId).catch((err) =>
          console.error("scheduleRebuildLinks follow-up failed:", err),
        );
      }
    }
  })();
  inflight.set(brainId, p);
  return p;
}
