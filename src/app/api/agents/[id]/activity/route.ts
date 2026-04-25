import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { currentAuth } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/agents/[id]/activity
 *
 * Recent `vault_change_log` entries attributed to this agent. Pagination is
 * cursor-based on `createdAt` (ISO-8601). We filter by `actorType` / `actorId`
 * for proper actor attribution.
 *
 * Read activity is intentionally skipped for MVP; a future iteration can
 * synthesize entries from request logs.
 */

type RouteContext = { params: Promise<{ id: string }> };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function unauthorized() {
  return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  const { user, organizationId } = auth;

  if (!organizationId) {
    return NextResponse.json({ error: "no_active_org" }, { status: 400 });
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { role: true },
  });
  if (!membership) return forbidden();

  const { id: agentId } = await ctx.params;

  const rawLimit = req.nextUrl.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (rawLimit) {
    const parsed = Number(rawLimit);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(Math.floor(parsed), MAX_LIMIT);
    }
  }

  const cursor = req.nextUrl.searchParams.get("cursor");
  let cursorDate: Date | null = null;
  if (cursor) {
    const d = new Date(cursor);
    if (!isNaN(d.getTime())) {
      cursorDate = d;
    }
  }

  return withTenant(
    { organizationId, userId: user.id },
    async ({ tx }) => {
      const agent = await tx.agent.findFirst({
        where: { id: agentId },
        select: { id: true },
      });
      if (!agent) return notFound();

      // Fetch one extra row to compute `nextCursor` without a second query.
      const rows = await tx.vaultChangeLog.findMany({
        where: {
          actorType: "agent",
          actorId: agentId,
          ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        select: {
          id: true,
          brainId: true,
          documentId: true,
          path: true,
          operation: true,
          source: true,
          createdAt: true,
        },
      });

      const hasMore = rows.length > limit;
      const slice = hasMore ? rows.slice(0, limit) : rows;

      const entries = slice.map((r) => ({
        id: r.id,
        brainId: r.brainId,
        documentId: r.documentId,
        path: r.path,
        operation: r.operation,
        source: r.source,
        createdAt: r.createdAt,
      }));

      const nextCursor = hasMore ? slice[slice.length - 1].createdAt : null;

      return NextResponse.json({
        entries,
        nextCursor: nextCursor ? nextCursor.toISOString() : null,
      });
    },
  );
}
