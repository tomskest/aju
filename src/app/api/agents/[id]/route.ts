import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { currentAuth } from "@/lib/auth";
import { canManageMembers, canManageOrg, type OrgRole } from "@/lib/tenant";

export const runtime = "nodejs";

/**
 * Agent detail route — mirrors /api/orgs/[id] shape.
 */

type RouteContext = { params: Promise<{ id: string }> };

function unauthorized() {
  return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

/**
 * GET /api/agents/[id]
 *
 * Returns the agent plus the brains it can access.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  const { user, organizationId } = auth;

  if (!organizationId) {
    return NextResponse.json({ error: "no_active_org" }, { status: 400 });
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { role: true },
  });
  if (!membership) return forbidden();

  const { id } = await ctx.params;
  return withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      const agent = await tx.agent.findFirst({
        where: { id },
      });
      if (!agent) return notFound();

      const grants = await tx.brainAccess.findMany({
        where: { agentId: id },
        orderBy: { createdAt: "asc" },
        include: {
          brain: { select: { id: true, name: true, type: true } },
        },
      });

      return NextResponse.json({
        agent: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          status: agent.status,
          createdByUserId: agent.createdByUserId,
          createdAt: agent.createdAt,
        },
        brains: grants.map((g) => ({
          accessId: g.id,
          brainId: g.brain.id,
          brainName: g.brain.name,
          brainType: g.brain.type,
          role: g.role,
          grantedAt: g.createdAt,
        })),
      });
    },
  );
}

type PatchPayload = {
  name?: unknown;
  description?: unknown;
  status?: unknown;
};

const ALLOWED_PATCH_STATUSES = new Set(["active", "paused"]);

/**
 * PATCH /api/agents/[id]
 *
 * Update name/description/status. Only "active" and "paused" are accepted
 * here — revocation goes through DELETE. Requires owner/admin.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_agents" },
      { status: 403 },
    );
  }
  const { user, organizationId } = auth;

  if (!organizationId) {
    return NextResponse.json({ error: "no_active_org" }, { status: 400 });
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { role: true },
  });
  if (!membership) return forbidden();
  if (!canManageMembers(membership.role as OrgRole)) return forbidden();

  const { id } = await ctx.params;

  let body: PatchPayload;
  try {
    body = (await req.json()) as PatchPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  return withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      const agent = await tx.agent.findFirst({
        where: { id },
      });
      if (!agent) return notFound();

      const updates: {
        name?: string;
        description?: string | null;
        status?: string;
      } = {};

      if (typeof body.name === "string") {
        const name = body.name.trim();
        if (!name) {
          return NextResponse.json({ error: "name_required" }, { status: 400 });
        }
        if (name.length > 120) {
          return NextResponse.json({ error: "name_too_long" }, { status: 400 });
        }
        updates.name = name;
      }

      if ("description" in body) {
        if (body.description === null) {
          updates.description = null;
        } else if (typeof body.description === "string") {
          const desc = body.description.trim();
          if (desc.length > 2000) {
            return NextResponse.json(
              { error: "description_too_long" },
              { status: 400 },
            );
          }
          updates.description = desc || null;
        }
      }

      if (typeof body.status === "string") {
        if (!ALLOWED_PATCH_STATUSES.has(body.status)) {
          return NextResponse.json({ error: "invalid_status" }, { status: 400 });
        }
        if (agent.status === "revoked") {
          return NextResponse.json(
            { error: "agent_revoked" },
            { status: 409 },
          );
        }
        updates.status = body.status;
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: "no_changes" }, { status: 400 });
      }

      const refreshed = await tx.agent.update({
        where: { id },
        data: updates,
      });

      return NextResponse.json({
        agent: {
          id: refreshed.id,
          name: refreshed.name,
          description: refreshed.description,
          status: refreshed.status,
          createdByUserId: refreshed.createdByUserId,
          createdAt: refreshed.createdAt,
        },
      });
    },
  );
}

/**
 * DELETE /api/agents/[id]
 *
 * Soft-delete: flip status to "revoked". Owner-only.
 *
 * TODO(agent-api-keys): Once `ApiKey` carries an `ownerType` / `ownerId` pair
 * (or an explicit `agentId` column), cascade-revoke every key where
 * ownerType="agent" and ownerId=agent.id so credentials die alongside the
 * principal. Today `ApiKey` is scoped by `userId`, so there's nothing
 * agent-specific to revoke here.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_agents" },
      { status: 403 },
    );
  }
  const { user, organizationId } = auth;

  if (!organizationId) {
    return NextResponse.json({ error: "no_active_org" }, { status: 400 });
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { role: true },
  });
  if (!membership) return forbidden();
  if (!canManageOrg(membership.role as OrgRole)) return forbidden();

  const { id } = await ctx.params;

  return withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      const agent = await tx.agent.findFirst({
        where: { id },
      });
      if (!agent) return notFound();

      if (agent.status === "revoked") {
        return NextResponse.json({ ok: true, alreadyRevoked: true });
      }

      await tx.agent.update({
        where: { id },
        data: { status: "revoked" },
      });

      // Cascade-revoke every API key that authenticates AS this agent.
      // Credentials die with the principal; a fresh key is required to
      // reactivate a later-resumed agent.
      const keyRevoke = await prisma.apiKey.updateMany({
        where: { agentId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return NextResponse.json({ ok: true, keysRevoked: keyRevoke.count });
    },
  );
}
