/**
 * Monthly agent-spend cap for an org (admin-only).
 * GET returns the effective limit + current month usage; PUT upserts.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authedOrgRoute } from "@/lib/route-helpers";
import { validateBody } from "@/lib/validators";
import { recordAudit, clientIp } from "@/lib/audit";
import { slackIntegrationEnabled } from "@/lib/agent/flags";
import { checkAgentSpendLimit } from "@/lib/agent/metering";

type Params = { orgId: string };

const putSpendSchema = z.object({
  monthlyCostCents: z.number().int().min(0).max(10_000_000),
  hardStop: z.boolean().default(true),
});

export const GET = authedOrgRoute<Params>(
  async ({ organizationId }) => {
    if (!slackIntegrationEnabled()) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const spend = await checkAgentSpendLimit(organizationId);
    return {
      spentCents: spend.spentCents,
      limitCents: spend.limitCents,
      hardStop: spend.hardStop,
    };
  },
  { minRole: "admin", orgIdParam: "orgId" },
);

export const PUT = authedOrgRoute<Params>(
  async ({ req, organizationId, user }) => {
    if (!slackIntegrationEnabled()) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const validation = await validateBody(req, putSpendSchema);
    if (!validation.ok) return validation.response;
    const { monthlyCostCents, hardStop } = validation.value;

    const before = await prisma.integrationSpendLimit.findUnique({
      where: { organizationId },
    });
    const limit = await prisma.integrationSpendLimit.upsert({
      where: { organizationId },
      create: { organizationId, monthlyCostCents, hardStop },
      update: { monthlyCostCents, hardStop },
    });
    await recordAudit(prisma, {
      eventType: "slack.spend_limit_updated",
      actorUserId: user.id,
      organizationId,
      resourceType: "integration_spend_limit",
      resourceId: limit.id,
      changes: {
        before: before
          ? { monthlyCostCents: before.monthlyCostCents, hardStop: before.hardStop }
          : null,
        after: { monthlyCostCents, hardStop },
      },
      ipAddress: clientIp(req),
    });
    return { limit: { monthlyCostCents: limit.monthlyCostCents, hardStop: limit.hardStop } };
  },
  { minRole: "admin", orgIdParam: "orgId", requiresScope: "write" },
);
