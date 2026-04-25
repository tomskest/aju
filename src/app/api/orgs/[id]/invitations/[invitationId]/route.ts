import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentAuth } from "@/lib/auth";
import { canManageMembers, type OrgRole } from "@/lib/tenant";

/**
 * DELETE /api/orgs/[id]/invitations/[invitationId]
 *
 * Cancel a pending invitation. Requires owner/admin role in the
 * organization. Keyed on the DB row id, not the secret token.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; invitationId: string }> },
) {
  const { id: organizationId, invitationId } = await ctx.params;

  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_orgs" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { id: true, organizationId: true },
  });

  if (!invitation || invitation.organizationId !== organizationId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const callerMembership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: user.id,
      },
    },
    select: { role: true },
  });

  if (!callerMembership || !canManageMembers(callerMembership.role as OrgRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.invitation.delete({ where: { id: invitation.id } });

  return NextResponse.json({ ok: true });
}
