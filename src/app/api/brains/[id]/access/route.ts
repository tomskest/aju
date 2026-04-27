import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { currentAuth } from "@/lib/auth";
import { clientIp, recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Brain access management — user-backed BrainAccess grants.
 *
 * GET lists explicit user grants (agent grants surface on the agent detail
 * page, not here). POST grants a user access to this brain. Both endpoints
 * require the caller to own the brain.
 *
 * Invited users must already be members of the org that owns the tenant.
 * Organization-level membership is the trust boundary; brain-level grants
 * gate which brains within the org a member can reach.
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
function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/**
 * GET /api/brains/[id]/access
 *
 * List user-backed BrainAccess rows for a brain, hydrated with the caller's
 * org's user records. Owner-only.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  const { user, organizationId } = auth;
  if (!organizationId) return badRequest("no_active_org");

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { id: true },
  });
  if (!membership) return forbidden();

  const { id: brainId } = await ctx.params;

  return withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      const brain = await tx.brain.findUnique({
        where: { id: brainId },
        select: { id: true, name: true, type: true },
      });
      if (!brain) return notFound();

      const ownership = await tx.brainAccess.findFirst({
        where: { brainId, userId: user.id, role: "owner" },
        select: { id: true },
      });
      if (!ownership) return forbidden();

      const rows = await tx.brainAccess.findMany({
        where: { brainId, userId: { not: null } },
        orderBy: { createdAt: "asc" },
      });

      const userIds = rows
        .map((r) => r.userId)
        .filter((x): x is string => typeof x === "string");
      const users = userIds.length
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, name: true },
          })
        : [];
      const byId = new Map(users.map((u) => [u.id, u]));

      const members = rows.flatMap((r) => {
        if (!r.userId) return [];
        const u = byId.get(r.userId);
        if (!u) return [];
        return [
          {
            accessId: r.id,
            userId: u.id,
            email: u.email,
            name: u.name,
            role: r.role,
            grantedAt: r.createdAt.toISOString(),
          },
        ];
      });

      return NextResponse.json({
        brain: { id: brain.id, name: brain.name, type: brain.type },
        members,
      });
    },
  );
}

type GrantPayload = {
  email?: unknown;
  userId?: unknown;
  role?: unknown;
};

/**
 * POST /api/brains/[id]/access
 *
 * Grant a user explicit access to this brain. Accepts `email` or `userId`.
 * Owner-only. The target user must already be a member of the brain's org.
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
  if (!organizationId) return badRequest("no_active_org");

  const callerMembership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { id: true },
  });
  if (!callerMembership) return forbidden();

  const { id: brainId } = await ctx.params;

  let body: GrantPayload;
  try {
    body = (await req.json()) as GrantPayload;
  } catch {
    return badRequest("invalid_json");
  }

  const emailInput =
    typeof body.email === "string" && body.email.trim()
      ? body.email.trim().toLowerCase()
      : null;
  const userIdInput =
    typeof body.userId === "string" && body.userId.trim()
      ? body.userId.trim()
      : null;
  if (!emailInput && !userIdInput) {
    return badRequest("email_or_userId_required");
  }

  if (
    typeof body.role !== "string" ||
    !GRANT_ROLES.includes(body.role as GrantRole)
  ) {
    return badRequest("invalid_role");
  }
  const role = body.role as GrantRole;

  // Resolve target user from control DB.
  const target = userIdInput
    ? await prisma.user.findUnique({
        where: { id: userIdInput },
        select: { id: true, email: true, name: true },
      })
    : await prisma.user.findUnique({
        where: { email: emailInput! },
        select: { id: true, email: true, name: true },
      });
  if (!target) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  // Target must be a member of this org. We don't auto-invite — that's the
  // org-admin's job. Brain access is an in-org permission.
  const targetMembership = await prisma.organizationMembership.findFirst({
    where: { userId: target.id, organizationId },
    select: { id: true },
  });
  if (!targetMembership) {
    return NextResponse.json(
      { error: "user_not_in_organization" },
      { status: 400 },
    );
  }

  return withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      const brain = await tx.brain.findUnique({
        where: { id: brainId },
        select: { id: true, name: true, type: true },
      });
      if (!brain) return notFound();

      const ownership = await tx.brainAccess.findFirst({
        where: { brainId, userId: user.id, role: "owner" },
        select: { id: true },
      });
      if (!ownership) return forbidden();

      const existing = await tx.brainAccess.findUnique({
        where: { brainId_userId: { brainId, userId: target.id } },
        select: { id: true, role: true },
      });

      const grant = await tx.brainAccess.upsert({
        where: { brainId_userId: { brainId, userId: target.id } },
        create: { brainId, userId: target.id, role },
        update: { role },
        select: { id: true },
      });

      await recordAudit(prisma, {
        eventType: "brain.access.granted",
        actorUserId: user.id,
        organizationId,
        resourceType: "brain_access",
        resourceId: grant.id,
        changes: {
          before: existing ? { role: existing.role } : undefined,
          after: { role, brainId, brainName: brain.name, userId: target.id },
        },
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
            userId: target.id,
            email: target.email,
            name: target.name,
            role,
          },
        },
        { status: existing ? 200 : 201 },
      );
    },
  );
}
