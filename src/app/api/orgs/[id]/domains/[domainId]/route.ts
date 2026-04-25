import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authedOrgRoute } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Params = { id: string; domainId: string };

/**
 * DELETE /api/orgs/[id]/domains/[domainId]
 * Owner-only removal. Responds with 204 on success.
 */
export const DELETE = authedOrgRoute<Params>(
  async ({ organizationId, params }) => {
    const { domainId } = params;
    const domain = await prisma.organizationDomain.findUnique({
      where: { id: domainId },
    });
    if (!domain || domain.organizationId !== organizationId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await prisma.organizationDomain.delete({ where: { id: domainId } });
    return new NextResponse(null, { status: 204 });
  },
  { orgIdParam: "id", minRole: "owner" },
);
