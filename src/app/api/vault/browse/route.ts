import { resolveBrain, isBrainError } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

export const GET = authedTenantRoute(async ({ req, tx, principal }) => {
  const brain = await resolveBrain(tx, req, principal);
  if (isBrainError(brain)) return brain;

  const directory = req.nextUrl.searchParams.get("directory");
  const section = req.nextUrl.searchParams.get("section");
  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    Math.max(parseInt(rawLimit || "100", 10) || 100, 1),
    500,
  );
  const cursor = req.nextUrl.searchParams.get("cursor");

  const where: Record<string, unknown> = { brainId: brain.brainId };
  if (directory) where.directory = directory;
  if (section) where.section = section;
  if (cursor) where.path = { gt: cursor };

  const rows = await tx.vaultDocument.findMany({
    where,
    select: {
      id: true,
      path: true,
      title: true,
      section: true,
      directory: true,
      docType: true,
      docStatus: true,
      tags: true,
      wordCount: true,
      updatedAt: true,
    },
    orderBy: { path: "asc" },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const docs = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? docs[docs.length - 1].path : null;

  return {
    count: docs.length,
    documents: docs,
    nextCursor,
  };
});
