import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authedOrgRoute } from "@/lib/route-helpers";
import { clientIp, recordAudit } from "@/lib/audit";
import { orgRoleSchema, validateBody } from "@/lib/validators";

type Params = { id: string; userId: string };

const patchMemberSchema = z.object({ role: orgRoleSchema });

/**
 * Acquire a transaction-scoped advisory lock keyed on `org-owner-guard:<orgId>`.
 * All "is this the last owner?" checks for the same org serialize behind this
 * lock, so concurrent role-demotion / removal requests can't both observe
 * `owners >= 2` and both succeed, leaving the org with zero owners. The lock
 * releases automatically when the surrounding transaction commits or aborts.
 */
async function lockOwnerGuard(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  const key = `org-owner-guard:${organizationId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/**
 * PATCH /api/orgs/[id]/members/[userId]
 *
 * Change a member's role. Requires owner/admin. Rejects demoting the last
 * owner with 400 `last_owner`. The owner-count read and the role-update run
 * inside one transaction with a per-org advisory lock so concurrent
 * demotions can't both pass the guard.
 */
export const PATCH = authedOrgRoute<Params>(
  async ({ req, user, organizationId, params }) => {
    const { userId: targetUserId } = params;

    const validation = await validateBody(req, patchMemberSchema);
    if (!validation.ok) return validation.response;
    const newRole = validation.value.role;

    return prisma.$transaction(async (tx) => {
      await lockOwnerGuard(tx, organizationId);

      const target = await tx.organizationMembership.findUnique({
        where: {
          organizationId_userId: { organizationId, userId: targetUserId },
        },
        select: { id: true, role: true },
      });

      if (!target) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }

      // No-op: same role.
      if (target.role === newRole) {
        return NextResponse.json({ ok: true });
      }

      // Guard: demoting the last owner is forbidden. Count is consistent
      // because we hold the per-org advisory lock; no concurrent demotion
      // can move the count out from under us.
      if (target.role === "owner" && newRole !== "owner") {
        const owners = await tx.organizationMembership.count({
          where: { organizationId, role: "owner" },
        });
        if (owners <= 1) {
          return NextResponse.json({ error: "last_owner" }, { status: 400 });
        }
      }

      await tx.organizationMembership.update({
        where: { id: target.id },
        data: { role: newRole, version: { increment: 1 } },
      });

      await recordAudit(tx, {
        eventType: "member.role_changed",
        actorUserId: user.id,
        organizationId,
        resourceType: "membership",
        resourceId: target.id,
        changes: { before: { role: target.role }, after: { role: newRole } },
        metadata: { targetUserId },
        ipAddress: clientIp(req),
      });

      return NextResponse.json({ ok: true });
    });
  },
  { orgIdParam: "id", minRole: "admin" },
);

/**
 * DELETE /api/orgs/[id]/members/[userId]
 *
 * Remove a member from the organization. Requires owner/admin. Rejects
 * removing the last owner (including self-removal in that case) with 400
 * `last_owner`. Same lock-then-count-then-mutate pattern as PATCH.
 */
export const DELETE = authedOrgRoute<Params>(
  async ({ req, user, organizationId, params }) => {
    const { userId: targetUserId } = params;

    return prisma.$transaction(async (tx) => {
      await lockOwnerGuard(tx, organizationId);

      const target = await tx.organizationMembership.findUnique({
        where: {
          organizationId_userId: { organizationId, userId: targetUserId },
        },
        select: { id: true, role: true },
      });

      if (!target) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }

      if (target.role === "owner") {
        const owners = await tx.organizationMembership.count({
          where: { organizationId, role: "owner" },
        });
        if (owners <= 1) {
          return NextResponse.json({ error: "last_owner" }, { status: 400 });
        }
      }

      await tx.organizationMembership.delete({
        where: { id: target.id },
      });

      await recordAudit(tx, {
        eventType: "member.removed",
        actorUserId: user.id,
        organizationId,
        resourceType: "membership",
        resourceId: target.id,
        changes: { before: { role: target.role } },
        metadata: { targetUserId },
        ipAddress: clientIp(req),
      });

      return NextResponse.json({ ok: true });
    });
  },
  { orgIdParam: "id", minRole: "admin" },
);
