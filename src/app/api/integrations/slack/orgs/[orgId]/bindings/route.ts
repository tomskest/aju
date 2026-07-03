/**
 * Channel bindings CRUD (admin-only).
 *
 * POST validates the tenant-side targets before writing the control-plane
 * row: the agent must exist and hold editor/owner on the brain (grants are
 * the real security boundary — the binding just points at them), and the
 * bot must be able to see the channel (conversations.info doubles as the
 * "bot is actually in this workspace/channel" check).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withTenant, decryptDsn } from "@/lib/tenant";
import { authedOrgRoute } from "@/lib/route-helpers";
import { validateBody } from "@/lib/validators";
import { recordAudit, clientIp } from "@/lib/audit";
import { slackIntegrationEnabled } from "@/lib/agent/flags";
import { SlackApiError, SlackClient } from "@/lib/agent/slack";
import { DEFAULT_TOOL_NAMES } from "@/lib/agent/tools";

type Params = { orgId: string };

const createBindingSchema = z.object({
  channelId: z.string().min(1).max(64),
  agentId: z.string().min(1).max(64),
  brainId: z.string().min(1).max(64),
  mode: z.enum(["mention"]).default("mention"), // "ambient" is Phase 2
  toolPolicy: z.array(z.enum(DEFAULT_TOOL_NAMES)).min(1).optional(),
});

export const GET = authedOrgRoute<Params>(
  async ({ organizationId }) => {
    if (!slackIntegrationEnabled()) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const bindings = await prisma.slackChannelBinding.findMany({
      where: { installation: { organizationId } },
      orderBy: { createdAt: "asc" },
    });
    return { bindings };
  },
  { minRole: "admin", orgIdParam: "orgId" },
);

export const POST = authedOrgRoute<Params>(
  async ({ req, organizationId, user }) => {
    if (!slackIntegrationEnabled()) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const validation = await validateBody(req, createBindingSchema);
    if (!validation.ok) return validation.response;
    const { channelId, agentId, brainId, mode, toolPolicy } = validation.value;

    const installation = await prisma.slackInstallation.findFirst({
      where: { organizationId, status: "active" },
    });
    if (!installation) {
      return NextResponse.json({ error: "not_installed" }, { status: 400 });
    }

    // Tenant-side validation: agent exists, brain exists, agent has write
    // grant on the brain. Unscoped tx — agent/brain tables carry no brain_id
    // RLS and the org DB boundary already scopes us.
    const targets = await withTenant({ organizationId, unscoped: true }, async ({ tx }) => {
      const [agent, brain, access] = await Promise.all([
        tx.agent.findUnique({ where: { id: agentId } }),
        tx.brain.findUnique({ where: { id: brainId } }),
        tx.brainAccess.findFirst({
          where: { agentId, brainId, role: { in: ["editor", "owner"] } },
          select: { id: true },
        }),
      ]);
      return { agent, brain, hasWriteGrant: Boolean(access) };
    });
    if (!targets.agent) {
      return NextResponse.json({ error: "agent_not_found" }, { status: 400 });
    }
    if (!targets.brain) {
      return NextResponse.json({ error: "brain_not_found" }, { status: 400 });
    }
    if (!targets.hasWriteGrant) {
      return NextResponse.json({ error: "agent_needs_editor_grant_on_brain" }, { status: 400 });
    }

    // Channel must be visible to the bot; also gives us the display name.
    let channelName: string;
    try {
      const slack = new SlackClient(decryptDsn(installation.botTokenEnc));
      const info = await slack.conversationsInfo(channelId);
      channelName = info.name ?? channelId;
    } catch (err) {
      if (err instanceof SlackApiError) {
        return NextResponse.json(
          { error: "channel_not_visible_to_bot", detail: err.code },
          { status: 400 },
        );
      }
      throw err;
    }

    const existing = await prisma.slackChannelBinding.findUnique({
      where: {
        installationId_channelId: {
          installationId: installation.id,
          channelId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "channel_already_bound" }, { status: 409 });
    }

    const binding = await prisma.slackChannelBinding.create({
      data: {
        installationId: installation.id,
        channelId,
        channelName,
        agentId,
        agentName: targets.agent.name,
        brainId,
        brainName: targets.brain.name,
        mode,
        toolPolicy: toolPolicy ?? undefined,
      },
    });
    await recordAudit(prisma, {
      eventType: "slack.binding_created",
      actorUserId: user.id,
      organizationId,
      resourceType: "slack_channel_binding",
      resourceId: binding.id,
      metadata: { channelId, channelName, agentId, brainId, mode },
      ipAddress: clientIp(req),
    });
    return { binding };
  },
  { minRole: "admin", orgIdParam: "orgId", requiresScope: "write" },
);
