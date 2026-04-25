import { NextResponse } from "next/server";
import {
  resolveBrain,
  isBrainError,
  resolveAccessibleBrainIds,
  isAllBrains,
} from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

export const GET = authedTenantRoute(async ({ req, tx, principal }) => {
  // Resolve brain IDs for filtering
  let brainIds: string[];
  if (isAllBrains(req)) {
    brainIds = await resolveAccessibleBrainIds(tx, principal);
  } else {
    const brain = await resolveBrain(tx, req, principal);
    if (isBrainError(brain)) return brain;
    brainIds = [brain.brainId];
  }

  const since = req.nextUrl.searchParams.get("since");
  if (!since) {
    return NextResponse.json(
      { error: "Missing required parameter: since (ISO timestamp)" },
      { status: 400 },
    );
  }

  const sinceDate = new Date(since);
  if (isNaN(sinceDate.getTime())) {
    return NextResponse.json(
      { error: "Invalid timestamp format for: since" },
      { status: 400 },
    );
  }

  const excludeSource = req.nextUrl.searchParams.get("excludeSource");
  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    Math.max(parseInt(rawLimit || "100", 10) || 100, 1),
    500,
  );
  const cursor = req.nextUrl.searchParams.get("cursor");
  const cursorDate = cursor ? new Date(cursor) : null;
  const validCursor =
    cursorDate && !isNaN(cursorDate.getTime()) ? cursorDate : null;

  const where: Record<string, unknown> = {
    brainId: { in: brainIds },
    createdAt: validCursor
      ? { gte: sinceDate, gt: validCursor }
      : { gte: sinceDate },
  };

  if (excludeSource) {
    where.source = { not: excludeSource };
  }

  // Fetch one extra row so we can compute nextCursor without re-querying.
  // `content` deliberately omitted here — list responses should never
  // page-load whole documents. Callers fetch document bodies via
  // /api/vault/document on demand. `contentHash` is enough to detect
  // changes against a local cache.
  const rows = await tx.vaultChangeLog.findMany({
    where,
    include: {
      document: { select: { contentHash: true } },
    },
    orderBy: { createdAt: "asc" },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? slice[slice.length - 1].createdAt.toISOString()
    : null;

  return {
    since,
    count: slice.length,
    changes: slice,
    nextCursor,
  };
});
