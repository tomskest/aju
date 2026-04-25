import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authedOrgRoute } from "@/lib/route-helpers";

type Params = { id: string; invitationId: string };

/**
 * DELETE /api/orgs/[id]/invitations/[invitationId]
 *
 * Cancel a pending invitation. Requires owner/admin role in the
 * organization. Keyed on the DB row id, not the secret token.
 */
export const DELETE = authedOrgRoute<Params>(
  async ({ organizationId, params }) => {
    const { invitationId } = params;

    const invitation = await prisma.invitation.findUnique({
      where: { id: invitationId },
      select: { id: true, organizationId: true },
    });

    if (!invitation || invitation.organizationId !== organizationId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await prisma.invitation.delete({ where: { id: invitation.id } });

    return { ok: true };
  },
  { orgIdParam: "id", minRole: "admin" },
);
