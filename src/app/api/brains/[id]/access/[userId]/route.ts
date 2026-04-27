import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { currentAuth } from "@/lib/auth";
import { clientIp, recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Per-user brain-access management.
 *
 * PATCH changes a user's role on a brain. DELETE revokes a user's grant.
 * Both are owner-only and refuse to leave the brain without an owner — at
 * least one BrainAccess row with `role: "owner"` must remain.
 */

type RouteContext = { params: Promise<{ id: string; userId: string }> };
type GrantRole = "viewer" | "editor" | "owner";
const GRANT_ROLES: readonly GrantRole[] = ["viewer", "editor", "owner"];

function unauthorized() {
  return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
}
function forbidden() {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}
function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}
function conflict(error: string) {
  return NextResponse.json({ error }, { status: 409 });
}

type PatchPayload = { role?: unknown };

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_modify_grants" },
      { status: 403 },
    );
  }
  const { user, organizationId } = auth;
  if (!organizationId) return badRequest("no_active_org");

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { id: true },
  });
  if (!membership) return forbidden();

  const { id: brainId, userId: targetUserId } = await ctx.params;

  let body: PatchPayload;
  try {
    body = (await req.json()) as PatchPayload;
  } catch {
    return badRequest("invalid_json");
  }
  if (
    typeof body.role !== "string" ||
    !GRANT_ROLES.includes(body.role as GrantRole)
  ) {
    return badRequest("invalid_role");
  }
  const role = body.role as GrantRole;

  return withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      const ownership = await tx.brainAccess.findFirst({
        where: { brainId, userId: user.id, role: "owner" },
        select: { id: true },
      });
      if (!ownership) return forbidden();

      const existing = await tx.brainAccess.findUnique({
        where: { brainId_userId: { brainId, userId: targetUserId } },
        select: { id: true, role: true },
      });
      if (!existing) return notFound();

      // Last-owner guard: refuse to demote the only remaining owner.
      if (existing.role === "owner" && role !== "owner") {
        const ownerCount = await tx.brainAccess.count({
          where: { brainId, role: "owner", userId: { not: null } },
        });
        if (ownerCount <= 1) return conflict("cannot_demote_last_owner");
      }

      await tx.brainAccess.update({
        where: { id: existing.id },
        data: { role },
      });

      await recordAudit(prisma, {
        eventType: "brain.access.updated",
        actorUserId: user.id,
        organizationId,
        resourceType: "brain_access",
        resourceId: existing.id,
        changes: { before: { role: existing.role }, after: { role } },
        metadata: { action: "role_updated", targetUserId },
        ipAddress: clientIp(req),
      });

      return NextResponse.json({ ok: true, role });
    },
  );
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_modify_grants" },
      { status: 403 },
    );
  }
  const { user, organizationId } = auth;
  if (!organizationId) return badRequest("no_active_org");

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { id: true },
  });
  if (!membership) return forbidden();

  const { id: brainId, userId: targetUserId } = await ctx.params;

  return withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      const ownership = await tx.brainAccess.findFirst({
        where: { brainId, userId: user.id, role: "owner" },
        select: { id: true },
      });
      if (!ownership) return forbidden();

      const existing = await tx.brainAccess.findUnique({
        where: { brainId_userId: { brainId, userId: targetUserId } },
        select: { id: true, role: true },
      });
      if (!existing) return notFound();

      // Last-owner guard: deletion of the only remaining owner row would
      // strand the brain. The owner can transfer ownership first, then leave.
      if (existing.role === "owner") {
        const ownerCount = await tx.brainAccess.count({
          where: { brainId, role: "owner", userId: { not: null } },
        });
        if (ownerCount <= 1) return conflict("cannot_remove_last_owner");
      }

      await tx.brainAccess.delete({ where: { id: existing.id } });

      await recordAudit(prisma, {
        eventType: "brain.access.revoked",
        actorUserId: user.id,
        organizationId,
        resourceType: "brain_access",
        resourceId: existing.id,
        changes: { before: { role: existing.role }, after: null },
        metadata: { action: "revoked", targetUserId },
        ipAddress: clientIp(req),
      });

      return NextResponse.json({ ok: true });
    },
  );
}
