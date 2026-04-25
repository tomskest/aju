import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentAuth } from "@/lib/auth";
import { provisionTenant } from "@/lib/tenant";
import { canManageOrg, type OrgRole } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/orgs/[id]/provision
 *
 * Manual retry for a stuck tenant. Used when the synchronous
 * `provisionTenant` call inside signup / org-create fails (Neon hiccup,
 * transient network, etc.) and leaves the tenant row in status='provisioning'
 * or the organization with no tenant row at all.
 *
 * Idempotent — safe to hit repeatedly. Only the org owner can trigger.
 */
export async function POST(req: NextRequest, { params }: Params) {
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

  const { id: orgId } = await params;

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId: orgId },
    select: { role: true },
  });
  if (!membership || !canManageOrg(membership.role as OrgRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await provisionTenant(orgId);
  } catch (err) {
    console.error(`[provision] ${orgId} failed:`, err);
    return NextResponse.json(
      {
        error: "provisioning_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { organizationId: orgId },
    select: { status: true, schemaVersion: true, databaseName: true },
  });

  return NextResponse.json({ ok: true, tenant });
}
