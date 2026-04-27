import { NextResponse } from "next/server";
import { resolveBrain, isBrainError } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

// List the version history of a single document. Metadata only —
// `content` is omitted so a doc with hundreds of versions doesn't
// dominate a list response. Callers pull individual versions with
// /api/vault/document/version when they need the body.
//
// Pagination: cursor is the createdAt of the last row in the previous
// page. Newest-first is the default — most callers want "what changed
// recently"; an explicit ?direction=oldest flips it for full-history
// reconstructions.
export const GET = authedTenantRoute(async ({ req, tx, principal }) => {
  const brain = await resolveBrain(tx, req, principal);
  if (isBrainError(brain)) return brain;

  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json(
      { error: "Missing required parameter: path" },
      { status: 400 },
    );
  }

  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    Math.max(parseInt(rawLimit || "50", 10) || 50, 1),
    200,
  );
  const cursor = req.nextUrl.searchParams.get("cursor");
  const cursorDate = cursor ? new Date(cursor) : null;
  const validCursor =
    cursorDate && !isNaN(cursorDate.getTime()) ? cursorDate : null;

  const direction =
    req.nextUrl.searchParams.get("direction") === "oldest" ? "asc" : "desc";

  // Confirm the document exists in the active brain before scanning
  // versions — otherwise an empty result is ambiguous between "doc
  // doesn't exist" and "doc exists with no history".
  const doc = await tx.vaultDocument.findFirst({
    where: { brainId: brain.brainId, path },
    select: { id: true, contentHash: true },
  });
  if (!doc) {
    return NextResponse.json(
      { error: `Document not found: ${path}` },
      { status: 404 },
    );
  }

  const rows = await tx.vaultDocumentVersion.findMany({
    where: {
      brainId: brain.brainId,
      documentId: doc.id,
      ...(validCursor
        ? direction === "desc"
          ? { createdAt: { lt: validCursor } }
          : { createdAt: { gt: validCursor } }
        : {}),
    },
    select: {
      id: true,
      versionN: true,
      contentHash: true,
      parentHash: true,
      mergeParentHash: true,
      source: true,
      changedBy: true,
      message: true,
      createdAt: true,
    },
    orderBy: { createdAt: direction },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? slice[slice.length - 1].createdAt.toISOString()
    : null;

  return {
    path,
    headHash: doc.contentHash,
    direction,
    versions: slice.map((v) => ({
      id: v.id,
      versionN: v.versionN,
      contentHash: v.contentHash,
      parentHash: v.parentHash,
      mergeParentHash: v.mergeParentHash,
      source: v.source,
      changedBy: v.changedBy,
      message: v.message,
      createdAt: v.createdAt.toISOString(),
    })),
    nextCursor,
  };
});
