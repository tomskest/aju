/**
 * Job queue glue — graphile-worker on the control database.
 *
 * Graphile Worker owns its own `graphile_worker` schema (created by its
 * migration runner at first use), invisible to Prisma; `prisma migrate
 * deploy` is unaffected. The web process only ENQUEUES (plain INSERT via
 * WorkerUtils); consuming happens in the separate worker service
 * (src/worker/main.ts).
 */
import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";

export const AGENT_MENTION_TASK = "agent.mention";
export const AGENT_JOB_MAX_ATTEMPTS = 5;

export type AgentMentionJob = {
  agentRunId: string;
  channel: string;
  /** Raw mention text (includes the <@BOT> token; the loop strips it). */
  text: string;
  ts: string;
  threadTs?: string;
  slackUserId: string;
};

const globalForQueue = globalThis as unknown as {
  workerUtilsPromise: Promise<WorkerUtils> | undefined;
};

function workerUtils(): Promise<WorkerUtils> {
  if (!globalForQueue.workerUtilsPromise) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for the agent job queue");
    }
    globalForQueue.workerUtilsPromise = makeWorkerUtils({ connectionString });
  }
  return globalForQueue.workerUtilsPromise;
}

export async function enqueueAgentMention(job: AgentMentionJob): Promise<void> {
  const utils = await workerUtils();
  await utils.addJob(AGENT_MENTION_TASK, job, {
    maxAttempts: AGENT_JOB_MAX_ATTEMPTS,
  });
}
