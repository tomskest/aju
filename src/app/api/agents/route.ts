import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { currentAuth } from "@/lib/auth";
import { canManageMembers, type OrgRole } from "@/lib/tenant";
import { requireScope } from "@/lib/route-helpers";

export const runtime = "nodejs";

/**
 * Agent management — non-human principals that hold scoped API keys.
 */

function unauthorized() {
  return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

/**
 * GET /api/agents
 *
 * List agents in the caller's active org. Requires the caller to be a
 * member of that org (any role).
 */
export async function GET(req: NextRequest) {
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

  // Agent table has no RLS policy (no brain_id column) — the DB boundary is
  // sufficient — but we go through withTenant for a uniform code path.
  return withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      const rows = await tx.agent.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          _count: { select: { brainAccess: true } },
        },
      });

      const agents = rows.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        status: a.status,
        createdAt: a.createdAt,
        brainAccessCount: a._count.brainAccess,
      }));

      return NextResponse.json({ agents });
    },
  );
}

type CreatePayload = {
  name?: unknown;
  description?: unknown;
};

/**
 * POST /api/agents
 *
 * Create an agent scoped to the caller's active org. Requires owner/admin.
 */
export async function POST(req: NextRequest) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_create_agents" },
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

  const scopeDenied = requireScope(auth, "admin");
  if (scopeDenied) return scopeDenied;

  let body: CreatePayload;
  try {
    body = (await req.json()) as CreatePayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (!rawName) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (rawName.length > 120) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }

  const rawDesc =
    typeof body.description === "string" ? body.description.trim() : null;
  if (rawDesc && rawDesc.length > 2000) {
    return NextResponse.json(
      { error: "description_too_long" },
      { status: 400 },
    );
  }

  return withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      const created = await tx.agent.create({
        data: {
          name: rawName,
          description: rawDesc && rawDesc.length > 0 ? rawDesc : null,
          createdByUserId: user.id,
          status: "active",
        },
      });

      return NextResponse.json(
        {
          agent: {
            id: created.id,
            name: created.name,
            description: created.description,
            status: created.status,
            createdAt: created.createdAt,
            brainAccessCount: 0,
          },
        },
        { status: 201 },
      );
    },
  );
}
