import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";

/**
 * Hash an invite token using SHA-256 — matches the hashing in
 * `POST /api/orgs/[id]/invitations`.
 */
function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * GET /api/invitations/[token]
 *
 * Public endpoint (no auth required). The invitee follows a link like
 * `https://aju.sh/invitations/<token>/accept`, and the page preview fetches
 * this to show the org name + role before the user signs in.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;

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
      organization: { select: { name: true, slug: true } },
    },
  });

  if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
    return NextResponse.json(
      { error: "invalid_or_expired" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    organization: {
      name: invitation.organization.name,
      slug: invitation.organization.slug,
    },
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
  });
}
