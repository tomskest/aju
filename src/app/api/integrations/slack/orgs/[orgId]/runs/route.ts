/**
 * Agent run log for an org (admin-only) — the "who tagged, what ran, what
 * it cost" audit surface. Cursor-paginated, newest first.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authedOrgRoute } from "@/lib/route-helpers";
import { slackIntegrationEnabled } from "@/lib/agent/flags";

type Params = { orgId: string };

export const GET = authedOrgRoute<Params>(
  async ({ req, organizationId }) => {
    if (!slackIntegrationEnabled()) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(Number.parseInt(sp.get("limit") ?? "50", 10) || 50, 200);
    const cursor = sp.get("cursor");

    const runs = await prisma.agentRun.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        bindingId: true,
        channelId: true,
        threadTs: true,
        requestedBySlackUserId: true,
        agentId: true,
        status: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        costCents: true,
        toolCalls: true,
        error: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
      },
    });
    const hasMore = runs.length > limit;
    const page = hasMore ? runs.slice(0, limit) : runs;
    return {
      runs: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  },
  { minRole: "admin", orgIdParam: "orgId" },
);
