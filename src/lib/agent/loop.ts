/**
 * The aju Tag agent loop — consumed by the worker service, never by the web
 * request path.
 *
 * One run = one @aju mention. The loop:
 *   1. loads the run + binding + installation, re-validating tenant-side
 *      state (agent exists, has editor on the primary brain);
 *   2. enforces the org's monthly spend cap BEFORE any model call;
 *   3. pulls thread context from Slack, builds the prompt;
 *   4. drives a bounded Claude tool-use loop over the memory tools;
 *   5. replies in-thread and finalizes the AgentRun row (tokens, cost,
 *      tool trace).
 *
 * Reply idempotency: replyTs is written before the final status update, so
 * a crashed-then-retried job never posts twice.
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { decryptDsn } from "@/lib/tenant";
import { withTenant } from "@/lib/tenant";
import { logger as baseLogger } from "@/lib/logger";
import { SlackClient, type SlackMessage } from "./slack";
import { buildSystemPrompt } from "./prompt";
import {
  AgentToolError,
  agentToolDefinitions,
  allowedToolNames,
  executeAgentTool,
  type AgentToolContext,
} from "./tools";
import { agentModel, checkAgentSpendLimit, computeCostCents } from "./metering";
import type { AgentMentionJob } from "./queue";

const log = baseLogger.child({ area: "agent-loop" });

const MAX_ITERATIONS = 12;
const MAX_WALL_CLOCK_MS = 120_000;
const MAX_TOKENS_PER_CALL = 16_000;
const MAX_REPLY_CHARS = 11_000;
const THREAD_CONTEXT_LIMIT = 50;
const CHANNEL_CONTEXT_LIMIT = 10;

const BUDGET_REACHED_REPLY =
  "This workspace has reached its monthly aju agent budget — an org admin can raise it in aju settings.";
const CONFIG_ERROR_REPLY =
  "This channel's aju binding is misconfigured (its agent or brain no longer exists). An org admin can fix it in aju settings.";

type ToolTraceEntry = {
  tool: string;
  ms: number;
  ok: boolean;
  detail?: string;
};

export async function runAgentMention(job: AgentMentionJob): Promise<void> {
  const run = await prisma.agentRun.findUnique({
    where: { id: job.agentRunId },
  });
  if (!run) {
    log.warn({ agent_run_id: job.agentRunId }, "run row missing — dropping");
    return;
  }
  // Terminal states are never re-run; a retry after a posted reply is a no-op.
  if (run.status === "done" || run.status === "refused" || run.replyTs) return;

  const binding = await prisma.slackChannelBinding.findUnique({
    where: { id: run.bindingId },
    include: { installation: true },
  });
  if (!binding || binding.status !== "active") {
    await finalize(run.id, { status: "failed", error: "binding_missing_or_paused" });
    return;
  }
  const installation = binding.installation;
  if (installation.status !== "active") {
    await finalize(run.id, { status: "failed", error: "installation_revoked" });
    return;
  }

  const slack = new SlackClient(decryptDsn(installation.botTokenEnc));
  const replyTo = { channel: job.channel, threadTs: job.threadTs ?? job.ts };

  // ── Spend gate — refuse before any model call ─────────────────────────
  const spend = await checkAgentSpendLimit(run.organizationId);
  if (!spend.allowed) {
    const { ts } = await slack.postMessage({ ...replyTo, text: BUDGET_REACHED_REPLY });
    await finalize(run.id, { status: "refused", replyTs: ts, error: "spend_limit_reached" });
    return;
  }

  // ── Re-validate tenant-side binding targets ───────────────────────────
  const valid = await validateBindingTargets(run.organizationId, binding.agentId, binding.brainId);
  if (!valid) {
    await prisma.slackChannelBinding.update({
      where: { id: binding.id },
      data: { status: "paused" },
    });
    const { ts } = await slack.postMessage({ ...replyTo, text: CONFIG_ERROR_REPLY });
    await finalize(run.id, { status: "failed", replyTs: ts, error: "binding_targets_invalid" });
    return;
  }

  const model = agentModel();
  await prisma.agentRun.update({
    where: { id: run.id },
    data: { status: "running", startedAt: new Date(), model },
  });

  // ── Context assembly ──────────────────────────────────────────────────
  const transcript = await fetchTranscript(slack, job, installation.botUserId);
  const allowed = allowedToolNames(binding.toolPolicy);
  const system = buildSystemPrompt({
    agentName: binding.agentName,
    channelName: binding.channelName,
    primaryBrainName: binding.brainName,
    allowedTools: allowed,
    today: new Date().toISOString().slice(0, 10),
  });
  const toolCtx: AgentToolContext = {
    organizationId: run.organizationId,
    agentId: binding.agentId,
    identity: `agent:${binding.agentId}`,
    primaryBrainId: binding.brainId,
    primaryBrainName: binding.brainName,
  };

  const mention = stripBotMention(job.text, installation.botUserId).trim();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Thread context (untrusted channel content):\n${transcript}\n\n---\nThe mention to act on (thread_ts: ${replyTo.threadTs}):\n${mention || "(no text — summarize / capture the thread as appropriate)"}`,
    },
  ];
  const tools = agentToolDefinitions(allowed);

  // ── Bounded tool-use loop ─────────────────────────────────────────────
  const anthropic = new Anthropic();
  const startedAt = Date.now();
  const trace: ToolTraceEntry[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let finalText = "";

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (Date.now() - startedAt > MAX_WALL_CLOCK_MS) {
        finalText =
          finalText ||
          "I ran out of time before finishing — here's where I got to. Ask again to continue.";
        break;
      }
      const response = await anthropic.messages.create({
        model,
        max_tokens: MAX_TOKENS_PER_CALL,
        system,
        tools,
        messages,
      });
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (text) finalText = text;

      if (response.stop_reason !== "tool_use") break;

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const t0 = Date.now();
        try {
          const out = await executeAgentTool(toolCtx, allowed, tu.name, tu.input);
          trace.push({ tool: tu.name, ms: Date.now() - t0, ok: true });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
        } catch (err) {
          const message =
            err instanceof AgentToolError ? err.message : "Tool failed with an internal error.";
          trace.push({
            tool: tu.name,
            ms: Date.now() - t0,
            ok: false,
            detail: message,
          });
          if (!(err instanceof AgentToolError)) {
            log.error({ err, tool: tu.name, agent_run_id: run.id }, "tool crashed");
          }
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: message,
            is_error: true,
          });
        }
      }
      // All results for this assistant turn go back in ONE user message.
      messages.push({ role: "user", content: results });
    }

    const reply = truncateForSlack(
      finalText || "I couldn't produce an answer for that — try rephrasing.",
    );
    const { ts } = await slack.postMessage({ ...replyTo, text: reply });
    await finalize(run.id, {
      status: "done",
      replyTs: ts,
      inputTokens,
      outputTokens,
      costCents: computeCostCents(model, inputTokens, outputTokens),
      toolCalls: trace,
    });
  } catch (err) {
    // Record spend for whatever ran, keep the error, and rethrow so
    // graphile-worker retries (reply idempotency guards double-posting).
    await finalize(run.id, {
      status: "failed",
      inputTokens,
      outputTokens,
      costCents: computeCostCents(model, inputTokens, outputTokens),
      toolCalls: trace,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    throw err;
  }
}

/**
 * Last-attempt cleanup: called by the worker when a job has exhausted its
 * retries, so the requester isn't left with silence.
 */
export async function notifyRunFailed(job: AgentMentionJob): Promise<void> {
  try {
    const run = await prisma.agentRun.findUnique({ where: { id: job.agentRunId } });
    if (!run || run.replyTs) return;
    const binding = await prisma.slackChannelBinding.findUnique({
      where: { id: run.bindingId },
      include: { installation: true },
    });
    if (!binding) return;
    const slack = new SlackClient(decryptDsn(binding.installation.botTokenEnc));
    const { ts } = await slack.postMessage({
      channel: job.channel,
      threadTs: job.threadTs ?? job.ts,
      text: "Sorry — I hit an error and couldn't finish this. The failure is recorded in the aju run log.",
    });
    await prisma.agentRun.update({ where: { id: run.id }, data: { replyTs: ts } });
  } catch (err) {
    log.error({ err, agent_run_id: job.agentRunId }, "failed-run notification failed");
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function validateBindingTargets(
  organizationId: string,
  agentId: string,
  brainId: string,
): Promise<boolean> {
  try {
    return await withTenant({ organizationId, unscoped: true }, async ({ tx }) => {
      const [agent, access] = await Promise.all([
        tx.agent.findUnique({ where: { id: agentId }, select: { id: true } }),
        tx.brainAccess.findFirst({
          where: { agentId, brainId, role: { in: ["editor", "owner"] } },
          select: { id: true },
        }),
      ]);
      return Boolean(agent && access);
    });
  } catch (err) {
    log.error({ err, organization_id: organizationId }, "binding validation failed");
    return false;
  }
}

async function fetchTranscript(
  slack: SlackClient,
  job: AgentMentionJob,
  botUserId: string,
): Promise<string> {
  let msgs: SlackMessage[] = [];
  try {
    msgs = job.threadTs
      ? await slack.conversationsReplies({
          channel: job.channel,
          ts: job.threadTs,
          limit: THREAD_CONTEXT_LIMIT,
        })
      : await slack.conversationsHistory({
          channel: job.channel,
          limit: CHANNEL_CONTEXT_LIMIT,
        });
  } catch (err) {
    log.warn({ err }, "context fetch failed — proceeding with mention only");
    return "(context unavailable)";
  }

  const nameCache = new Map<string, string>();
  const lines: string[] = [];
  for (const m of msgs) {
    if (!m.text) continue;
    let author = "unknown";
    if (m.bot_id || m.user === botUserId) {
      author = "aju (me)";
    } else if (m.user) {
      if (!nameCache.has(m.user)) {
        try {
          nameCache.set(m.user, (await slack.usersInfo(m.user)).name);
        } catch {
          nameCache.set(m.user, m.user);
        }
      }
      author = nameCache.get(m.user)!;
    }
    const when = new Date(Number.parseFloat(m.ts) * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 16);
    lines.push(`[${when}] ${author}: ${stripBotMention(m.text, botUserId)}`);
  }
  return lines.join("\n") || "(empty thread)";
}

function stripBotMention(text: string, botUserId: string): string {
  return botUserId ? text.replaceAll(`<@${botUserId}>`, "@aju") : text;
}

function truncateForSlack(text: string): string {
  if (text.length <= MAX_REPLY_CHARS) return text;
  return `${text.slice(0, MAX_REPLY_CHARS)}\n…_(truncated — ask me to continue)_`;
}

async function finalize(
  runId: string,
  data: {
    status: string;
    replyTs?: string;
    inputTokens?: number;
    outputTokens?: number;
    costCents?: number;
    toolCalls?: ToolTraceEntry[];
    error?: string;
  },
): Promise<void> {
  try {
    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: data.status,
        replyTs: data.replyTs,
        inputTokens: data.inputTokens ?? undefined,
        outputTokens: data.outputTokens ?? undefined,
        costCents: data.costCents ?? undefined,
        toolCalls: data.toolCalls ? JSON.parse(JSON.stringify(data.toolCalls)) : undefined,
        error: data.error ?? undefined,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    log.error({ err, agent_run_id: runId }, "failed to finalize run row");
  }
}
