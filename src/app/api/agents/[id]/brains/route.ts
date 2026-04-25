import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { currentAuth } from "@/lib/auth";
import { clientIp, recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Brain-grant management for agents.
 *
 * POST grants an agent access to a brain (requires that the caller owns the
 * brain — we use `BrainAccess.role = "owner"` to mean ownership). GET lists
 * the agent's current grants.
 */

type RouteContext = { params: Promise<{ id: string }> };
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

/**
 * GET /api/agents/[id]/brains
 *
 * Same shape as the detail route's `brains` array.
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
        select: { id: true, status: true },
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

type GrantPayload = {
  brainId?: unknown;
  brainName?: unknown;
  role?: unknown;
};

/**
 * POST /api/agents/[id]/brains
 *
 * Grant the agent access to a brain. Accepts either `brainId` or
 * `brainName` so CLI callers can pass a human-readable name without first
 * looking up the id. Requires the caller to own the brain
 * (BrainAccess.role = "owner").
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_grant_brains" },
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

  const { id } = await ctx.params;

  let body: GrantPayload;
  try {
    body = (await req.json()) as GrantPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const brainIdInput =
    typeof body.brainId === "string" && body.brainId.trim()
      ? body.brainId.trim()
      : null;
  const brainNameInput =
    typeof body.brainName === "string" && body.brainName.trim()
      ? body.brainName.trim()
      : null;

  if (!brainIdInput && !brainNameInput) {
    return NextResponse.json(
      { error: "brainId_or_brainName_required" },
      { status: 400 },
    );
  }

  if (typeof body.role !== "string" || !GRANT_ROLES.includes(body.role as GrantRole)) {
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }
  const role = body.role as GrantRole;

  // Unscoped because we may be granting access to brains the caller doesn't
  // yet have on their in-session access list. The caller's ownership is
  // enforced below via a BrainAccess lookup inside the same tenant.
  return withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      const agent = await tx.agent.findFirst({
        where: { id },
        select: { id: true, status: true },
      });
      if (!agent) return notFound();

      if (agent.status === "revoked") {
        return NextResponse.json({ error: "agent_revoked" }, { status: 409 });
      }

      const brain = brainIdInput
        ? await tx.brain.findFirst({
            where: { id: brainIdInput },
            select: { id: true, name: true, type: true },
          })
        : await tx.brain.findFirst({
            where: { name: brainNameInput! },
            select: { id: true, name: true, type: true },
          });
      if (!brain) return notFound();

      const brainId = brain.id;

      // The caller must be an owner of this brain.
      const callerAccess = await tx.brainAccess.findFirst({
        where: { brainId, userId: user.id, role: "owner" },
        select: { id: true },
      });
      if (!callerAccess) return forbidden();

      // Idempotent upsert against the `(brain_id, agent_id)` unique
      // (added in tenant migration 20260425100000). The DB-level
      // constraint replaces the previous advisory-lock workaround:
      // concurrent inserts now resolve to UPDATE instead of leaving a
      // duplicate row. Pre-check existence so the response status can
      // distinguish 201 (new grant) from 200 (role bump on existing).
      const existing = await tx.brainAccess.findUnique({
        where: { brainId_agentId: { brainId, agentId: id } },
        select: { id: true },
      });

      const grant = await tx.brainAccess.upsert({
        where: { brainId_agentId: { brainId, agentId: id } },
        create: { brainId, agentId: id, role },
        update: { role },
        select: { id: true },
      });

      // Audit lives in the control DB and uses `prisma`, not `tx` (tenant
      // transaction). Soft commit semantics — if audit fails, the grant
      // still stands but a console.error is emitted. The `metadata.action`
      // distinguishes a fresh grant from a role bump on an existing one.
      await recordAudit(prisma, {
        eventType: "agent.granted",
        actorUserId: user.id,
        organizationId,
        agentId: id,
        resourceType: "brain_access",
        resourceId: grant.id,
        changes: { after: { role, brainId, brainName: brain.name } },
        metadata: { action: existing ? "role_updated" : "created" },
        ipAddress: clientIp(req),
      });

      return NextResponse.json(
        {
          ok: true,
          ...(existing ? { updated: true } : {}),
          grant: {
            accessId: grant.id,
            brainId: brain.id,
            brainName: brain.name,
            brainType: brain.type,
            role,
          },
        },
        { status: existing ? 200 : 201 },
      );
    },
  );
}
