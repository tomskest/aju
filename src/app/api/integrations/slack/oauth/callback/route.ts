/**
 * Slack OAuth v2 callback — completes the install.
 *
 * Slack redirects the installing admin's browser here with ?code and the
 * signed ?state minted by /oauth/start. We re-verify the admin's membership
 * (state is proof of intent, membership is re-checked at completion),
 * exchange the code, store the installation with the bot token encrypted,
 * and bounce back to the org's Slack settings page.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptDsn } from "@/lib/tenant";
import { recordAudit, clientIp } from "@/lib/audit";
import { logger as baseLogger } from "@/lib/logger";
import { slackIntegrationEnabled } from "@/lib/agent/flags";
import { findTeamConflict } from "@/lib/agent/install";
import { oauthV2Access, verifyOAuthState } from "@/lib/agent/slack";

const log = baseLogger.child({ area: "slack-oauth" });

function settingsUrl(orgId: string, outcome: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${appUrl}/app/orgs/${orgId}/settings/slack?install=${outcome}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!slackIntegrationEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const params = req.nextUrl.searchParams;
  const state = params.get("state");
  const parsed = state ? verifyOAuthState(state) : null;
  if (!parsed) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  }
  const { orgId, userId } = parsed;

  // User cancelled on Slack's consent screen.
  if (params.get("error")) {
    return NextResponse.redirect(settingsUrl(orgId, "cancelled"));
  }
  const code = params.get("code");
  if (!code) {
    return NextResponse.json({ error: "code_required" }, { status: 400 });
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, organizationId: orgId },
    select: { role: true },
  });
  if (!membership || membership.role === "member") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const result = await oauthV2Access({
      code,
      redirectUri: `${appUrl}/api/integrations/slack/oauth/callback`,
    });

    // One Slack workspace ↔ one aju org (see src/lib/agent/install.ts).
    const conflict = await findTeamConflict(result.teamId, orgId);
    if (conflict) {
      log.warn(
        {
          team_id: result.teamId,
          organization_id: orgId,
          bound_to_organization_id: conflict.organizationId,
        },
        "install rejected — workspace already bound to another org",
      );
      return NextResponse.redirect(settingsUrl(orgId, "team-conflict"));
    }

    const installation = await prisma.slackInstallation.upsert({
      where: {
        organizationId_teamId: { organizationId: orgId, teamId: result.teamId },
      },
      create: {
        organizationId: orgId,
        teamId: result.teamId,
        teamName: result.teamName,
        botUserId: result.botUserId,
        botTokenEnc: encryptDsn(result.botToken),
        scopes: result.scopes,
        installedByUserId: userId,
        status: "active",
      },
      update: {
        teamName: result.teamName,
        botUserId: result.botUserId,
        botTokenEnc: encryptDsn(result.botToken),
        scopes: result.scopes,
        installedByUserId: userId,
        status: "active",
      },
    });

    await recordAudit(prisma, {
      eventType: "slack.installed",
      actorUserId: userId,
      organizationId: orgId,
      resourceType: "slack_installation",
      resourceId: installation.id,
      metadata: { teamId: result.teamId, teamName: result.teamName },
      ipAddress: clientIp(req),
    });

    return NextResponse.redirect(settingsUrl(orgId, "ok"));
  } catch (err) {
    log.error({ err, organization_id: orgId }, "slack install failed");
    return NextResponse.redirect(settingsUrl(orgId, "error"));
  }
}
