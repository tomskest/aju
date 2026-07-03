/**
 * aju agent worker — a SEPARATE Railway service on the same repo.
 *
 *   npm run worker   (start command: `tsx src/worker/main.ts`)
 *
 * Consumes graphile-worker jobs from the control database and drives the
 * agent loop. The web service never runs this; it only enqueues. Deploying
 * with INTEGRATION_SLACK_ENABLED unset is safe — the process logs and exits
 * 0, so the service can ship dormant ahead of the flag flip.
 *
 * Graphile Worker provisions its own `graphile_worker` schema on first run;
 * Prisma migrations are unaffected.
 */
import "dotenv/config";
import { run, type Runner } from "graphile-worker";
import { logger as baseLogger } from "../lib/logger";
import { slackIntegrationEnabled } from "../lib/agent/flags";
import { AGENT_MENTION_TASK, type AgentMentionJob } from "../lib/agent/queue";
import { runAgentMention, notifyRunFailed } from "../lib/agent/loop";

const log = baseLogger.child({ area: "agent-worker" });

async function main(): Promise<void> {
  if (!slackIntegrationEnabled()) {
    log.info("INTEGRATION_SLACK_ENABLED is not set — worker exiting (dormant)");
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  const concurrency = Number.parseInt(process.env.WORKER_CONCURRENCY ?? "4", 10);

  const runner: Runner = await run({
    connectionString,
    concurrency: Number.isFinite(concurrency) ? concurrency : 4,
    taskList: {
      [AGENT_MENTION_TASK]: async (payload, helpers) => {
        const job = payload as AgentMentionJob;
        try {
          await runAgentMention(job);
        } catch (err) {
          const isLastAttempt = helpers.job.attempts >= helpers.job.max_attempts;
          if (isLastAttempt) {
            // Retries exhausted: tell the requester instead of going silent.
            await notifyRunFailed(job);
          }
          throw err; // rethrow so graphile-worker records/reschedules
        }
      },
    },
  });

  log.info({ concurrency }, "agent worker started — consuming agent.mention jobs");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down — finishing in-flight runs");
    try {
      await runner.stop();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await runner.promise;
}

main().catch((err) => {
  log.error({ err }, "agent worker crashed");
  process.exit(1);
});
