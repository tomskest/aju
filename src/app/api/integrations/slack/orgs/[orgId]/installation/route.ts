/**
 * Slack installation status for an org (admin-only).
 *
 * GET    → installation + bindings + spend snapshot (one payload for the UI)
 * DELETE → uninstall: mark the installation revoked and pause its bindings.
 *          The Slack-side app grant is left to Slack workspace admins; a
 *          revoked row here means events are ignored and no runs start.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authedOrgRoute } from "@/lib/route-helpers";
import { recordAudit, clientIp } from "@/lib/audit";
import { slackIntegrationEnabled } from "@/lib/agent/flags";
import { checkAgentSpendLimit, DEFAULT_MONTHLY_COST_CENTS } from "@/lib/agent/metering";

type Params = { orgId: string };

export const GET = authedOrgRoute<Params>(
  async ({ organizationId }) => {
    if (!slackIntegrationEnabled()) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const installation = await prisma.slackInstallation.findFirst({
      where: { organizationId, status: "active" },
      select: {
        id: true,
        teamId: true,
        teamName: true,
        botUserId: true,
        scopes: true,
        createdAt: true,
        bindings: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            channelId: true,
            channelName: true,
            agentId: true,
            agentName: true,
            brainId: true,
            brainName: true,
            mode: true,
            toolPolicy: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
    const spend = await checkAgentSpendLimit(organizationId);
    return {
      installation,
      spend: {
        spentCents: spend.spentCents,
        limitCents: spend.limitCents,
        hardStop: spend.hardStop,
        defaultLimitCents: DEFAULT_MONTHLY_COST_CENTS,
      },
    };
  },
  { minRole: "admin", orgIdParam: "orgId" },
);

export const DELETE = authedOrgRoute<Params>(
  async ({ req, organizationId, user }) => {
    if (!slackIntegrationEnabled()) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const installation = await prisma.slackInstallation.findFirst({
      where: { organizationId, status: "active" },
      select: { id: true, teamId: true },
    });
    if (!installation) {
      return NextResponse.json({ error: "not_installed" }, { status: 404 });
    }
    await prisma.$transaction([
      prisma.slackInstallation.update({
        where: { id: installation.id },
        data: { status: "revoked" },
      }),
      prisma.slackChannelBinding.updateMany({
        where: { installationId: installation.id, status: "active" },
        data: { status: "paused" },
      }),
    ]);
    await recordAudit(prisma, {
      eventType: "slack.uninstalled",
      actorUserId: user.id,
      organizationId,
      resourceType: "slack_installation",
      resourceId: installation.id,
      metadata: { teamId: installation.teamId },
      ipAddress: clientIp(req),
    });
    return { uninstalled: true };
  },
  { minRole: "admin", orgIdParam: "orgId", requiresScope: "write" },
);
