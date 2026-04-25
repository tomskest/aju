import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { currentAuth } from "@/lib/auth";
import {
  canManageMembers,
  ORG_ROLES,
  type OrgRole,
} from "@/lib/tenant";
import { sendEmail, orgInvitationEmail } from "@/lib/email";

const INVITE_TOKEN_BYTES = 36; // base64url encodes to 48 chars (ceil(36*4/3) = 48)
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_LIFETIME_HOURS = 7 * 24;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: organizationId } = await ctx.params;

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

  const callerMembership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: user.id },
    },
    select: { role: true },
  });

  if (!callerMembership || !canManageMembers(callerMembership.role as OrgRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

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

  return NextResponse.json({ invitations: rows });
}

/**
 * POST /api/orgs/[id]/invitations
 *
 * Create a new invitation, persist its token hash, and email the invitee.
 * Requires owner/admin.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: organizationId } = await ctx.params;

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

  const callerMembership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: user.id },
    },
    select: { role: true },
  });

  if (!callerMembership || !canManageMembers(callerMembership.role as OrgRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rawEmail = (body as { email?: unknown })?.email;
  const rawRole = (body as { role?: unknown })?.role;

  if (typeof rawEmail !== "string" || !EMAIL_RE.test(rawEmail)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();

  if (typeof rawRole !== "string" || !ORG_ROLES.includes(rawRole as OrgRole)) {
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }
  const role = rawRole as OrgRole;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });

  if (!organization) {
    return NextResponse.json({ error: "org_not_found" }, { status: 404 });
  }

  // Already a member?
  const existingMember = await prisma.organizationMembership.findFirst({
    where: {
      organizationId,
      user: { email },
    },
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
}
