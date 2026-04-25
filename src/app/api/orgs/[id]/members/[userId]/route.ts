import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentAuth } from "@/lib/auth";
import {
  canManageMembers,
  ORG_ROLES,
  type OrgRole,
} from "@/lib/tenant";

/**
 * Count current owners of an organization. Used to guard against demoting or
 * removing the last owner.
 */
async function countOwners(organizationId: string): Promise<number> {
  return prisma.organizationMembership.count({
    where: { organizationId, role: "owner" },
  });
}

/**
 * PATCH /api/orgs/[id]/members/[userId]
 *
 * Change a member's role. Requires owner/admin. Rejects demoting the last
 * owner with 400 `last_owner`.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: organizationId, userId: targetUserId } = await ctx.params;

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

  if (!callerMembership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!canManageMembers(callerMembership.role as OrgRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const role = (body as { role?: unknown })?.role;
  if (typeof role !== "string" || !ORG_ROLES.includes(role as OrgRole)) {
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }
  const newRole = role as OrgRole;

  const target = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: targetUserId },
    },
    select: { id: true, role: true },
  });

  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // No-op: same role
  if (target.role === newRole) {
    return NextResponse.json({ ok: true });
  }

  // Guard: demoting the last owner is forbidden.
  if (target.role === "owner" && newRole !== "owner") {
    const owners = await countOwners(organizationId);
    if (owners <= 1) {
      return NextResponse.json({ error: "last_owner" }, { status: 400 });
    }
  }

  await prisma.organizationMembership.update({
    where: { id: target.id },
    data: { role: newRole },
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/orgs/[id]/members/[userId]
 *
 * Remove a member from the organization. Requires owner/admin. Rejects
 * removing the last owner (including self-removal in that case) with 400
 * `last_owner`.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: organizationId, userId: targetUserId } = await ctx.params;

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

  if (!callerMembership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!canManageMembers(callerMembership.role as OrgRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const target = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: targetUserId },
    },
    select: { id: true, role: true },
  });

  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Guard: removing the last owner (including self) is forbidden.
  if (target.role === "owner") {
    const owners = await countOwners(organizationId);
    if (owners <= 1) {
      return NextResponse.json({ error: "last_owner" }, { status: 400 });
    }
  }

  await prisma.organizationMembership.delete({
    where: { id: target.id },
  });

  return NextResponse.json({ ok: true });
}
