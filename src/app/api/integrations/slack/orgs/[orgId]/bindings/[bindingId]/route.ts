/**
 * Single-binding updates (admin-only): pause/resume and tool-policy
 * narrowing. Bindings are paused, not deleted — runs reference them and the
 * audit trail should survive.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authedOrgRoute } from "@/lib/route-helpers";
import { validateBody } from "@/lib/validators";
import { recordAudit, clientIp } from "@/lib/audit";
import { slackIntegrationEnabled } from "@/lib/agent/flags";
import { DEFAULT_TOOL_NAMES } from "@/lib/agent/tools";

type Params = { orgId: string; bindingId: string };

const updateBindingSchema = z
  .object({
    status: z.enum(["active", "paused"]).optional(),
    toolPolicy: z.array(z.enum(DEFAULT_TOOL_NAMES)).min(1).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.toolPolicy !== undefined, "Nothing to update");

export const PATCH = authedOrgRoute<Params>(
  async ({ req, organizationId, user, params }) => {
    if (!slackIntegrationEnabled()) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const validation = await validateBody(req, updateBindingSchema);
    if (!validation.ok) return validation.response;
    const { status, toolPolicy } = validation.value;

    const binding = await prisma.slackChannelBinding.findFirst({
      where: { id: params.bindingId, installation: { organizationId } },
      select: { id: true, status: true, toolPolicy: true },
    });
    if (!binding) {
      return NextResponse.json({ error: "binding_not_found" }, { status: 404 });
    }

    const updated = await prisma.slackChannelBinding.update({
      where: { id: binding.id },
      data: {
        status: status ?? undefined,
        toolPolicy:
          toolPolicy === undefined ? undefined : toolPolicy === null ? Prisma.JsonNull : toolPolicy,
      },
    });
    await recordAudit(prisma, {
      eventType: "slack.binding_updated",
      actorUserId: user.id,
      organizationId,
      resourceType: "slack_channel_binding",
      resourceId: binding.id,
      changes: {
        before: { status: binding.status, toolPolicy: binding.toolPolicy },
        after: { status: updated.status, toolPolicy: updated.toolPolicy },
      },
      ipAddress: clientIp(req),
    });
    return { binding: updated };
  },
  { minRole: "admin", orgIdParam: "orgId", requiresScope: "write" },
);
