import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentAuth } from "@/lib/auth";
import { canManageMembers, type OrgRole } from "@/lib/tenant";
import { getEmailDomain } from "@/lib/billing";
import {
  sendEmail,
  accessRequestReviewEmail,
  accessRequestSubmittedEmail,
  accessRequestApprovedEmail,
} from "@/lib/email";

export const runtime = "nodejs";

const ACCESS_REQUEST_TTL_DAYS = 7;

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/orgs/[id]/access-requests
 * Admins (owner/admin) list pending requests for the org.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id: organizationId } = await params;

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
  if (!membership || !canManageMembers(membership.role as OrgRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const requests = await prisma.accessRequest.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ accessRequests: requests });
}

/**
 * POST /api/orgs/[id]/access-requests  { message? }
 *
 * Signed-in user asks to join the org. Gated on:
 *   - not already a member
 *   - email domain matches at least one verified domain on the org
 *   - no pending request already exists for this user+org
 *
 * If the org has `autoAcceptDomainRequests` enabled and the domain matches,
 * the membership is created immediately and the row is marked approved.
 * Otherwise admins are emailed and the row stays pending.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id: organizationId } = await params;

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

  const body = (await req.json().catch(() => ({}))) as { message?: unknown };
  const message =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim().slice(0, 500)
      : null;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      autoAcceptDomainRequests: true,
    },
  });
  if (!organization) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const existingMembership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: user.id },
    },
  });
  if (existingMembership) {
    return NextResponse.json(
      { error: "already_member" },
      { status: 409 }
    );
  }

  const userDomain = getEmailDomain(user.email);
  if (!userDomain) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const matchingDomain = await prisma.organizationDomain.findFirst({
    where: {
      organizationId,
      domain: userDomain,
      verifiedAt: { not: null },
    },
  });
  if (!matchingDomain) {
    return NextResponse.json(
      { error: "no_matching_domain" },
      { status: 403 }
    );
  }

  // Unique (orgId, requestingUserId) — if a row exists and is pending we
  // surface a friendly 409 rather than letting the DB trip the constraint.
  const existingRequest = await prisma.accessRequest.findUnique({
    where: {
      organizationId_requestingUserId: {
        organizationId,
        requestingUserId: user.id,
      },
    },
  });
  if (existingRequest && existingRequest.status === "pending") {
    return NextResponse.json(
      { error: "request_already_pending", accessRequestId: existingRequest.id },
      { status: 409 }
    );
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + ACCESS_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000
  );
  const shouldAutoAccept = organization.autoAcceptDomainRequests === true;

  // If a non-pending row exists (denied/canceled/expired), reuse its id by
  // deleting then recreating — Prisma has no "upsert based on unique" against
  // a compound unique without a recognisable input name pair, and the simpler
  // path is a delete-then-create inside the tx.
  const result = await prisma.$transaction(async (tx) => {
    if (existingRequest) {
      await tx.accessRequest.delete({ where: { id: existingRequest.id } });
    }

    if (shouldAutoAccept) {
      const noteParts = ["auto_accepted"];
      if (message) noteParts.unshift(message);
      const row = await tx.accessRequest.create({
        data: {
          organizationId,
          requestingUserId: user.id,
          email: user.email,
          status: "approved",
          message: noteParts.join(" | "),
          reviewedBy: null,
          reviewedAt: now,
          expiresAt,
        },
      });
      await tx.organizationMembership.create({
        data: {
          organizationId,
          userId: user.id,
          role: "member",
          acceptedAt: now,
        },
      });
      return { row, autoAccepted: true as const };
    }

    const row = await tx.accessRequest.create({
      data: {
        organizationId,
        requestingUserId: user.id,
        email: user.email,
        status: "pending",
        message,
        expiresAt,
      },
    });
    return { row, autoAccepted: false as const };
  });

  // Notify org admins when the request is not auto-approved.
  if (!result.autoAccepted) {
    const admins = await prisma.organizationMembership.findMany({
      where: {
        organizationId,
        role: { in: ["owner", "admin"] },
      },
      include: { user: { select: { email: true } } },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://aju.sh";
    const reviewUrl = `${appUrl}/app/orgs/${organization.slug}/access-requests`;

    await Promise.all(
      admins
        .map((m) => m.user?.email)
        .filter((e): e is string => typeof e === "string" && e.length > 0)
        .map((to) =>
          sendEmail(
            accessRequestReviewEmail({
              to,
              requesterEmail: user.email,
              orgName: organization.name,
              message: message ?? undefined,
              reviewUrl,
            }),
          ).catch((err) =>
            console.error("access-request email failed:", err),
          ),
        ),
    );
  }

  return NextResponse.json({
    status: result.row.status,
    accessRequestId: result.row.id,
  });
}
