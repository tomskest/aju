import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { currentAuth } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * DELETE /api/agents/[id]/brains/[brainId]
 *
 * Revoke an agent's access to a brain. Requires the caller to be an owner of
 * the brain.
 */

type RouteContext = {
  params: Promise<{ id: string; brainId: string }>;
};

function unauthorized() {
  return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_revoke_grants" },
      { status: 403 },
    );
  }
  const { user, organizationId } = auth;

  if (!organizationId) {
    return NextResponse.json({ error: "no_active_org" }, { status: 400 });
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { role: true },
  });
  if (!membership) return forbidden();

  const { id: agentId, brainId } = await ctx.params;

  return withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      // Confirm the agent lives in this tenant before doing anything destructive.
      const agent = await tx.agent.findFirst({
        where: { id: agentId },
        select: { id: true },
      });
      if (!agent) return notFound();

      // Owner check: caller must own the brain.
      const ownership = await tx.brainAccess.findFirst({
        where: { brainId, userId: user.id, role: "owner" },
        select: { id: true },
      });
      if (!ownership) return forbidden();

      const result = await tx.brainAccess.deleteMany({
        where: { brainId, agentId },
      });

      // deleteMany returns the affected row count. Zero means nothing to revoke —
      // 404 is the clearer signal than a silent 200.
      if (result.count === 0) return notFound();

      return NextResponse.json({ ok: true });
    },
  );
}
