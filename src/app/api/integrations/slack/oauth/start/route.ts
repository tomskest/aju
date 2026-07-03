/**
 * Kick off the Slack OAuth v2 install for an org.
 *
 * GET /api/integrations/slack/oauth/start?org=<orgId>
 *
 * Written against currentAuth directly (not authedOrgRoute) because the org
 * comes from a query param and the success path is a 302 to Slack, not JSON.
 * Only org owners/admins may install.
 */
import { NextRequest, NextResponse } from "next/server";
import { currentAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { slackIntegrationEnabled } from "@/lib/agent/flags";
import { makeOAuthState, SLACK_BOT_SCOPES } from "@/lib/agent/slack";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!slackIntegrationEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const clientId = process.env.SLACK_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const orgId = req.nextUrl.searchParams.get("org");
  if (!orgId) {
    return NextResponse.json({ error: "org_required" }, { status: 400 });
  }
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: auth.user.id, organizationId: orgId },
    select: { role: true },
  });
  if (!membership || membership.role === "member") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const authorize = new URL("https://slack.com/oauth/v2/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("scope", SLACK_BOT_SCOPES);
  authorize.searchParams.set("state", makeOAuthState(orgId, auth.user.id));
  authorize.searchParams.set("redirect_uri", `${appUrl}/api/integrations/slack/oauth/callback`);
  return NextResponse.redirect(authorize);
}
