import { NextResponse } from "next/server";
import { authedTenantRoute } from "@/lib/route-helpers";
import { resolveBrain, isBrainError } from "@/lib/vault";

// Paginated validation history. Mirrors the cursor pattern used by
// /api/vault/changes — `cursor` is an ISO timestamp pointing past the
// last row of the previous page.
//
//   ?path=<docPath>   → history for one doc (most common)
//   (omit path)       → history for the brain (rare; for audit views)
//
// Default order is descending (newest first); newest validation events
// are usually the most relevant for the UI history panel.

export const GET = authedTenantRoute(async ({ req, tx, principal }) => {
  const brain = await resolveBrain(tx, req, principal);
  if (isBrainError(brain)) return brain;

  const path = req.nextUrl.searchParams.get("path");
  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    Math.max(parseInt(rawLimit || "50", 10) || 50, 1),
    200,
  );
  const cursor = req.nextUrl.searchParams.get("cursor");
  const cursorDate = cursor ? new Date(cursor) : null;
  const validCursor =
    cursorDate && !isNaN(cursorDate.getTime()) ? cursorDate : null;

  const where: Record<string, unknown> = { brainId: brain.brainId };
  if (path) {
    const doc = await tx.vaultDocument.findFirst({
      where: { brainId: brain.brainId, path },
      select: { id: true },
    });
    if (!doc) {
      return NextResponse.json(
        { error: `Document not found: ${path}` },
        { status: 404 },
      );
    }
    where.documentId = doc.id;
  }
  if (validCursor) {
    where.createdAt = { lt: validCursor };
  }

  // Fetch one extra row to compute nextCursor without a count query.
  const rows = await tx.vaultValidationLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? slice[slice.length - 1].createdAt.toISOString()
    : null;

  return {
    brain: brain.brainName,
    path: path ?? null,
    count: slice.length,
    nextCursor,
    entries: slice.map((r) => ({
      id: r.id,
      path: r.path,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      fromProvenance: r.fromProvenance,
      toProvenance: r.toProvenance,
      contentHashAt: r.contentHashAt,
      source: r.source,
      changedBy: r.changedBy,
      actorType: r.actorType,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    })),
  };
});
