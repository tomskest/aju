import { resolveBrain, isBrainError } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

export const GET = authedTenantRoute(async ({ req, tx, principal }) => {
  const brain = await resolveBrain(tx, req, principal);
  if (isBrainError(brain)) return brain;

  const category = req.nextUrl.searchParams.get("category");
  const mimeType = req.nextUrl.searchParams.get("mimeType");
  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    Math.max(parseInt(rawLimit || "100", 10) || 100, 1),
    500,
  );
  const cursor = req.nextUrl.searchParams.get("cursor");
  const cursorDate = cursor ? new Date(cursor) : null;
  const validCursor =
    cursorDate && !isNaN(cursorDate.getTime()) ? cursorDate : null;

  const where: Record<string, unknown> = { brainId: brain.brainId };
  if (category) where.category = category;
  if (mimeType) where.mimeType = mimeType;
  if (validCursor) where.createdAt = { lt: validCursor };

  const rows = await tx.vaultFile.findMany({
    where,
    select: {
      id: true,
      s3Key: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      category: true,
      tags: true,
      textHash: true,
      uploadedBy: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const files = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? files[files.length - 1].createdAt.toISOString()
    : null;

  return {
    count: files.length,
    files,
    nextCursor,
  };
});
