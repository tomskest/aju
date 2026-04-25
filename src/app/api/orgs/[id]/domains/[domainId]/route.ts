import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentAuth } from "@/lib/auth";
import { canManageOrg, type OrgRole } from "@/lib/tenant";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; domainId: string }> };

/**
 * DELETE /api/orgs/[id]/domains/[domainId]
 * Owner-only removal. Responds with 204 on success.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id: organizationId, domainId } = await params;

  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_orgs" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const membership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: user.id },
    },
  });
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!canManageOrg(membership.role as OrgRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const domain = await prisma.organizationDomain.findUnique({
    where: { id: domainId },
  });
  if (!domain || domain.organizationId !== organizationId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.organizationDomain.delete({ where: { id: domainId } });
  return new NextResponse(null, { status: 204 });
}
