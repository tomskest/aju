/**
 * Agent-run cost metering and the per-org monthly spend cap.
 *
 * Follows the enforce* gate pattern from src/lib/billing/plan-limits.ts:
 * the check runs BEFORE the model is called; an org over its cap with
 * hardStop gets a `refused` run and a fixed Slack reply, never an API call.
 * Orgs without an IntegrationSpendLimit row get the conservative default.
 */
import { prisma } from "@/lib/db";

/** USD per 1M tokens, sticker prices. Update alongside model changes. */
const MODEL_PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export const DEFAULT_AGENT_MODEL = "claude-sonnet-5";
export const DEFAULT_MONTHLY_COST_CENTS = 2000;

export function agentModel(): string {
  return process.env.AGENT_MODEL || DEFAULT_AGENT_MODEL;
}

export function computeCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICES_PER_MTOK[model] ?? MODEL_PRICES_PER_MTOK[DEFAULT_AGENT_MODEL];
  const usd = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  return Math.ceil(usd * 100);
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getMonthlySpendCents(organizationId: string): Promise<number> {
  const agg = await prisma.agentRun.aggregate({
    where: { organizationId, createdAt: { gte: monthStart() } },
    _sum: { costCents: true },
  });
  return agg._sum.costCents ?? 0;
}

export type SpendCheck = {
  allowed: boolean;
  spentCents: number;
  limitCents: number;
  hardStop: boolean;
};

export async function checkAgentSpendLimit(organizationId: string): Promise<SpendCheck> {
  const [limit, spentCents] = await Promise.all([
    prisma.integrationSpendLimit.findUnique({ where: { organizationId } }),
    getMonthlySpendCents(organizationId),
  ]);
  const limitCents = limit?.monthlyCostCents ?? DEFAULT_MONTHLY_COST_CENTS;
  const hardStop = limit?.hardStop ?? true;
  const over = spentCents >= limitCents;
  return { allowed: !(over && hardStop), spentCents, limitCents, hardStop };
}
