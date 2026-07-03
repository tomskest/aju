/**
 * Slack Events API receiver.
 *
 * Contract (doc/spec-slack-tag.md §6): verify the v0 HMAC signature, handle
 * url_verification inline, dedupe on event_id via the AgentRun unique
 * constraint, enqueue, and ack 200 well inside Slack's 3-second budget. No
 * business logic runs here — the agent loop lives in the worker service.
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger as baseLogger } from "@/lib/logger";
import { slackIntegrationEnabled } from "@/lib/agent/flags";
import { verifySlackSignature } from "@/lib/agent/slack";
import { enqueueAgentMention } from "@/lib/agent/queue";

const log = baseLogger.child({ area: "slack-events" });

type SlackEventEnvelope = {
  type: string;
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event?: {
    type: string;
    user?: string;
    bot_id?: string;
    text?: string;
    ts: string;
    thread_ts?: string;
    channel: string;
  };
};

const ack = () => NextResponse.json({ ok: true });

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!slackIntegrationEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const verified = verifySlackSignature({
    signingSecret,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
    rawBody,
  });
  if (!verified) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: SlackEventEnvelope;
  try {
    body = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }
  if (body.type !== "event_callback" || !body.event || !body.team_id || !body.event_id) {
    return ack();
  }

  // Signature already proves origin; the rate limit is a runaway-workspace
  // backstop, and we still ack 200 so Slack doesn't retry into the limiter.
  const rl = checkRateLimit(`slack-events:${body.team_id}`, {
    limit: 60,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    log.warn({ team_id: body.team_id }, "event rate limit hit — dropping");
    return ack();
  }

  const event = body.event;
  // v1 surface: app_mention only. DMs and ambient messages are Phase 2+.
  if (event.type !== "app_mention" || event.bot_id) return ack();

  const installation = await prisma.slackInstallation.findFirst({
    where: { teamId: body.team_id, status: "active" },
    select: { id: true, organizationId: true },
  });
  if (!installation) return ack();

  const binding = await prisma.slackChannelBinding.findFirst({
    where: {
      installationId: installation.id,
      channelId: event.channel,
      status: "active",
    },
    select: { id: true, agentId: true },
  });
  // Unbound channel: stay silent rather than error-replying into it.
  if (!binding) return ack();

  let runId: string;
  try {
    const run = await prisma.agentRun.create({
      data: {
        organizationId: installation.organizationId,
        installationId: installation.id,
        bindingId: binding.id,
        channelId: event.channel,
        threadTs: event.thread_ts ?? event.ts,
        slackEventId: body.event_id,
        requestedBySlackUserId: event.user ?? "unknown",
        agentId: binding.agentId,
      },
    });
    runId = run.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Duplicate delivery (Slack retry) — the first one owns the run.
      return ack();
    }
    log.error({ err, event_id: body.event_id }, "run insert failed");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  try {
    await enqueueAgentMention({
      agentRunId: runId,
      channel: event.channel,
      text: event.text ?? "",
      ts: event.ts,
      threadTs: event.thread_ts,
      slackUserId: event.user ?? "unknown",
    });
  } catch (err) {
    // Release the dedupe slot so Slack's retry can re-enqueue cleanly —
    // otherwise the retry hits P2002 above and the mention is lost.
    log.error({ err, event_id: body.event_id }, "enqueue failed");
    await prisma.agentRun.delete({ where: { id: runId } }).catch(() => undefined);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return ack();
}
