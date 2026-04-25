import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { currentAuth, setActiveOrganizationId } from "@/lib/auth";

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * POST /api/invitations/[token]/accept
 *
 * Requires a signed-in session whose email matches the invitation email
 * (case-insensitive). On success creates (or reuses) an
 * OrganizationMembership, marks the invitation accepted, and sets the
 * active organization cookie so the caller lands in the new org on next
 * request.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;

  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json(
      {
        error: "unauthenticated",
        hint: "sign_in_required",
      },
      { status: 401 },
    );
  }
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_accept_invitations" },
      { status: 403 },
    );
  }
  const { user } = auth;

  if (!token) {
    return NextResponse.json(
      { error: "invalid_or_expired" },
      { status: 404 },
    );
  }

  const tokenHash = hashInviteToken(token);
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash },
    include: {
      organization: { select: { id: true, slug: true } },
    },
  });

  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
    return NextResponse.json(
      { error: "invalid_or_expired" },
      { status: 404 },
    );
  }

  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: "email_mismatch" }, { status: 403 });
  }

  const organizationId = invitation.organization.id;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const existing = await tx.organizationMembership.findUnique({
      where: {
        organizationId_userId: { organizationId, userId: user.id },
      },
      select: { id: true },
    });

    if (!existing) {
      await tx.organizationMembership.create({
        data: {
          organizationId,
          userId: user.id,
          role: invitation.role,
          invitedBy: invitation.createdBy,
          invitedAt: invitation.createdAt,
          acceptedAt: now,
        },
      });
    }

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: now },
    });
  });

  await setActiveOrganizationId(organizationId);

  return NextResponse.json({
    ok: true,
    organizationSlug: invitation.organization.slug,
  });
}
