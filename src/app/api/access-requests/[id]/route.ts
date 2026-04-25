import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentAuth } from "@/lib/auth";
import { canManageMembers, type OrgRole } from "@/lib/tenant";
import {
  sendEmail,
  accessRequestApprovedEmail,
  accessRequestDeniedEmail,
} from "@/lib/email";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/access-requests/[id]  { action: "approve" | "deny" }
 *
 * Owner/admin on the request's org decides the outcome. Approving creates
 * the membership atomically; denying just marks the row. Either path sends
 * a courtesy email to the requester.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;

  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_respond_to_access_requests" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action;
  if (action !== "approve" && action !== "deny") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const request = await prisma.accessRequest.findUnique({
    where: { id },
    include: {
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
  });
  if (!request) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Caller must be an admin on the org that owns the request.
  const callerMembership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: request.organizationId,
        userId: user.id,
      },
    },
    select: { role: true },
  });
  if (
    !callerMembership ||
    !canManageMembers(callerMembership.role as OrgRole)
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (request.status !== "pending") {
    return NextResponse.json(
      { error: "request_not_pending", status: request.status },
      { status: 409 }
    );
  }

  const now = new Date();

  if (action === "approve") {
    await prisma.$transaction(async (tx) => {
      await tx.accessRequest.update({
        where: { id },
        data: {
          status: "approved",
          reviewedBy: user.id,
          reviewedAt: now,
        },
      });
      // Defensive: if the requester already became a member through another
      // path, don't double-insert — upsert the membership.
      await tx.organizationMembership.upsert({
        where: {
          organizationId_userId: {
            organizationId: request.organizationId,
            userId: request.requestingUserId,
          },
        },
        update: {},
        create: {
          organizationId: request.organizationId,
          userId: request.requestingUserId,
          role: "member",
          acceptedAt: now,
        },
      });
    });

    if (request.organization) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://aju.sh";
      sendEmail(
        accessRequestApprovedEmail({
          to: request.email,
          orgName: request.organization.name,
          orgUrl: `${appUrl}/app/orgs/${request.organization.slug}`,
        })
      ).catch((err) =>
        console.error("access-request approval email failed:", err)
      );
    }

    return NextResponse.json({ status: "approved" });
  }

  // action === "deny"
  await prisma.accessRequest.update({
    where: { id },
    data: {
      status: "denied",
      reviewedBy: user.id,
      reviewedAt: now,
    },
  });

  if (request.organization) {
    sendEmail(
      accessRequestDeniedEmail({
        to: request.email,
        orgName: request.organization.name,
      })
    ).catch((err) => console.error("access-request denial email failed:", err));
  }

  return NextResponse.json({ status: "denied" });
}

/**
 * DELETE /api/access-requests/[id]
 * The requester cancels their own pending request.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;

  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { user } = auth;

  const request = await prisma.accessRequest.findUnique({
    where: { id },
    select: { id: true, requestingUserId: true, status: true },
  });
  if (!request) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (request.requestingUserId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.accessRequest.update({
    where: { id },
    data: {
      status: "canceled",
      reviewedAt: new Date(),
    },
  });

  return new NextResponse(null, { status: 204 });
}
