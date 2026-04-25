import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentAuth, setActiveOrganizationId } from "@/lib/auth";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/orgs/[id]/switch
 *
 * Pin the active org cookie for the caller's session. 404s if the caller
 * isn't a member of the target org (same existence-hiding as /api/orgs/[id]).
 *
 * Bearer-token callers (CLI/MCP) don't have a browser session; their active
 * org is pinned on the API key itself. We still accept the request and return
 * the target org id so the caller gets a uniform response shape, but we skip
 * the cookie write entirely.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_orgs" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const { id } = await ctx.params;
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId: id },
    select: { organizationId: true },
  });
  if (!membership) return notFound();

  if (!auth.apiKeyId) {
    await setActiveOrganizationId(membership.organizationId);
  }

  return NextResponse.json({ activeOrganizationId: membership.organizationId });
}
