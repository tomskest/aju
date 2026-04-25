import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sendEmail, orgInvitationEmail } from "@/lib/email";
import { authedOrgRoute } from "@/lib/route-helpers";
import { emailSchema, orgRoleSchema, validateBody } from "@/lib/validators";

const INVITE_TOKEN_BYTES = 36; // base64url encodes to 48 chars (ceil(36*4/3) = 48)
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_LIFETIME_HOURS = 7 * 24;

type Params = { id: string };

const createInviteSchema = z.object({
  email: emailSchema,
  role: orgRoleSchema,
});

function hashInviteToken(token: string): string {
  // SHA-256 is adequate for invite tokens — the random 48-char input has far
  // more entropy than any password, so a fast hash suffices (threat model:
  // a DB-read attacker shouldn't be able to accept invites).
  return createHash("sha256").update(token).digest("hex");
}

/**
 * GET /api/orgs/[id]/invitations
 *
 * List pending (not-yet-accepted) invitations for the organization. Requires
 * owner/admin.
 */
export const GET = authedOrgRoute<Params>(
  async ({ organizationId }) => {
    const rows = await prisma.invitation.findMany({
      where: { organizationId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        createdBy: true,
      },
    });
    return { invitations: rows };
  },
  { orgIdParam: "id", minRole: "admin" },
);

/**
 * POST /api/orgs/[id]/invitations
 *
 * Create a new invitation, persist its token hash, and email the invitee.
 * Requires owner/admin.
 */
export const POST = authedOrgRoute<Params>(
  async ({ req, organizationId, user }) => {
    const validation = await validateBody(req, createInviteSchema);
    if (!validation.ok) return validation.response;
    const { email, role } = validation.value;

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });
    if (!organization) {
      return NextResponse.json({ error: "org_not_found" }, { status: 404 });
    }

    // Already a member?
    const existingMember = await prisma.organizationMembership.findFirst({
      where: { organizationId, user: { email } },
      select: { id: true },
    });
    if (existingMember) {
      return NextResponse.json({ error: "already_member" }, { status: 409 });
    }

    // Pending invite already exists?
    const now = new Date();
    const pending = await prisma.invitation.findFirst({
      where: {
        organizationId,
        email,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (pending) {
      return NextResponse.json({ error: "already_invited" }, { status: 409 });
    }

    const token = randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
    const tokenHash = hashInviteToken(token);
    const expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS);

    const invitation = await prisma.invitation.create({
      data: {
        organizationId,
        email,
        role,
        tokenHash,
        expiresAt,
        createdBy: user.id,
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://aju.sh";
    const acceptUrl = `${appUrl}/invitations/${token}/accept`;
    const emailPayload = orgInvitationEmail({
      to: email,
      inviterName: user.name || user.email,
      orgName: organization.name,
      role,
      acceptUrl,
      expiresInHours: INVITE_LIFETIME_HOURS,
    });

    try {
      await sendEmail(emailPayload);
    } catch (err) {
      console.error("[invitations] send email failed:", err);
      // Don't roll back the invite — the admin can resend via UI later.
    }

    return NextResponse.json({ invitation }, { status: 201 });
  },
  { orgIdParam: "id", minRole: "admin" },
);
