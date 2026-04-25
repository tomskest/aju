import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { provisionTenant } from "@/lib/tenant";
import { authedOrgRoute } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

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
export const POST = authedOrgRoute<Params>(
  async ({ organizationId }) => {
    try {
      await provisionTenant(organizationId);
    } catch (err) {
      console.error(`[provision] ${organizationId} failed:`, err);
      return NextResponse.json(
        {
          error: "provisioning_failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }

    const tenant = await prisma.tenant.findUnique({
      where: { organizationId },
      select: { status: true, schemaVersion: true, databaseName: true },
    });

    return { ok: true, tenant };
  },
  { orgIdParam: "id", minRole: "owner" },
);
