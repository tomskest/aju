/**
 * Plan tiers + enforcement.
 *
 * Point-in-time caps are enforced at creation time by the helpers below —
 * routes call `enforce*Limit(...)` before `prisma.create` and early-return
 * the 402 NextResponse on a hit.
 *
 * The time-series counters (`searchesPerMonth`, `embeddingTokensPerMonth`)
 * are advertised so the usage page renders them, but NOT enforced here —
 * we need a `UsageEvent` table to measure them. Treat those as advisory.
 *
 * A 402 is the RFC-proper response for "limit reached, upgrade to continue";
 * clients should display `message` to the user and offer a path to raise the
 * cap (contact support during beta, Stripe checkout once billing lands).
 */
import { NextResponse } from "next/server";
import type {
  PrismaClient as PrismaClientTenant,
  Prisma as PrismaTenant,
} from "@prisma/client-tenant";
import { prisma, tenantDbFor } from "@/lib/db";

export const PLAN_LIMITS = {
  // Internal tier for founders / operators. Not self-assignable — flip a
  // user's plan_tier column directly in the control DB.
  beta_founder: {
    brains: 100,
    documentsPerBrain: 100_000,
    apiKeysMax: 100,
    searchesPerMonth: 1_000_000,
    embeddingTokensPerMonth: 100_000_000,
    storageBytesMax: 107_374_182_400, // 100 GiB
  },
  beta_legacy: {
    brains: 5,
    documentsPerBrain: 1000,
    apiKeysMax: 10,
    searchesPerMonth: 10_000,
    embeddingTokensPerMonth: 1_000_000,
    storageBytesMax: 1_073_741_824, // 1 GiB
  },
  free: {
    brains: 1,
    documentsPerBrain: 100,
    apiKeysMax: 2,
    searchesPerMonth: 500,
    embeddingTokensPerMonth: 50_000,
    storageBytesMax: 104_857_600, // 100 MiB
  },
} as const;

export type PlanTier = keyof typeof PLAN_LIMITS;
export type PlanLimits = (typeof PLAN_LIMITS)[PlanTier];
type HardCap = "brains" | "documentsPerBrain" | "apiKeysMax" | "storageBytesMax";

export function limitsFor(planTier: string | null | undefined): PlanLimits {
  if (planTier && planTier in PLAN_LIMITS) {
    return PLAN_LIMITS[planTier as PlanTier];
  }
  return PLAN_LIMITS.free;
}

async function getUserPlanTier(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { planTier: true },
  });
  return user?.planTier ?? "free";
}

function limitReached(
  limit: HardCap,
  current: number,
  max: number,
  planTier: string,
): NextResponse {
  const friendlyNames: Record<HardCap, string> = {
    brains: "brains",
    documentsPerBrain: "documents in this brain",
    apiKeysMax: "API keys",
    storageBytesMax: "storage",
  };
  const human = friendlyNames[limit];
  return NextResponse.json(
    {
      error: "plan_limit_reached",
      limit,
      current,
      max,
      planTier,
      message: `You've hit the ${planTier} limit on ${human} (${current}/${max}). Contact support to raise the cap or remove unused entries.`,
    },
    { status: 402 },
  );
}

/**
 * Enforce brains cap: total brainAccess rows the user holds across every
 * tenant they belong to (own + granted). Unreachable tenants are skipped
 * so a single provisioning failure doesn't silently waive the cap.
 */
export async function enforceBrainsLimit(
  userId: string,
): Promise<NextResponse | null> {
  const [planTier, count] = await Promise.all([
    getUserPlanTier(userId),
    countUserBrains(userId),
  ]);
  const max = limitsFor(planTier).brains;
  if (count >= max) return limitReached("brains", count, max, planTier);
  return null;
}

async function countUserBrains(userId: string): Promise<number> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId },
    select: { organizationId: true },
  });
  let total = 0;
  for (const m of memberships) {
    try {
      const tenant = await tenantDbFor(m.organizationId);
      total += await tenant.brainAccess.count({ where: { userId } });
    } catch {
      // Tenant unreachable — skip so a provisioning blip doesn't bypass
      // or explode enforcement. Failure-closed behaviour would block every
      // write during a tenant outage; failure-open is the pragmatic call.
    }
  }
  return total;
}

/**
 * Enforce API keys cap: non-revoked keys on the control DB (user-keys and
 * agent-keys minted by this user both count, matching the usage page).
 */
export async function enforceApiKeysLimit(
  userId: string,
): Promise<NextResponse | null> {
  const [planTier, count] = await Promise.all([
    getUserPlanTier(userId),
    prisma.apiKey.count({ where: { userId, revokedAt: null } }),
  ]);
  const max = limitsFor(planTier).apiKeysMax;
  if (count >= max) return limitReached("apiKeysMax", count, max, planTier);
  return null;
}

/**
 * Enforce per-brain document cap. Must be called inside the tenant client
 * (docs live in per-tenant DBs).
 *
 * Accepts either a tenant client or an already-open transaction client. The
 * create-route path passes its `tx` so the count uses the same connection as
 * the rest of the write — issuing a parallel non-tx `tenant.*` query against
 * a client whose interactive transaction is still open can deadlock on
 * pgbouncer-pooled Postgres (Neon), producing an unhandled throw that Next
 * surfaces as a 500 with an empty body.
 */
export async function enforceDocumentsPerBrainLimit(
  tenant: PrismaClientTenant | PrismaTenant.TransactionClient,
  brainId: string,
  userId: string,
): Promise<NextResponse | null> {
  const [planTier, count] = await Promise.all([
    getUserPlanTier(userId),
    tenant.vaultDocument.count({ where: { brainId } }),
  ]);
  const max = limitsFor(planTier).documentsPerBrain;
  if (count >= max) {
    return limitReached("documentsPerBrain", count, max, planTier);
  }
  return null;
}

/**
 * Enforce total storage cap across every brain the user can access.
 *
 * `additionalBytes` is the size of a pending upload the caller is about to
 * accept. Pass it so we reject BEFORE minting a presigned URL (saves a
 * round-trip to S3 for a write that'd be disallowed anyway). Defaults to 0
 * for callers that only want a post-write audit.
 *
 * `currentTenant` lets a route that already holds an open interactive
 * transaction on its own org's tenant client hand it in. Without this, the
 * enforcer would call `tenantDbFor(orgId)` for the same org and issue a
 * parallel `vaultFile.aggregate(...)` query — that races the open tx on
 * pgbouncer-pooled Postgres (Neon) and throws, surfacing as a 500 to the
 * client. Iteration over other orgs is unaffected: those tenants aren't in
 * an open transaction on this request.
 */
export async function enforceStorageLimit(
  userId: string,
  additionalBytes = 0,
  currentTenant?: {
    organizationId: string;
    tx: PrismaTenant.TransactionClient;
  },
): Promise<NextResponse | null> {
  const [planTier, current] = await Promise.all([
    getUserPlanTier(userId),
    sumUserStorage(userId, currentTenant),
  ]);
  const max = limitsFor(planTier).storageBytesMax;
  const projected = current + additionalBytes;
  if (projected > max) {
    return limitReached("storageBytesMax", projected, max, planTier);
  }
  return null;
}

async function sumUserStorage(
  userId: string,
  currentTenant?: {
    organizationId: string;
    tx: PrismaTenant.TransactionClient;
  },
): Promise<number> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId },
    select: { organizationId: true },
  });
  let total = 0;
  for (const m of memberships) {
    try {
      const client =
        currentTenant && currentTenant.organizationId === m.organizationId
          ? currentTenant.tx
          : await tenantDbFor(m.organizationId);
      const agg = await client.vaultFile.aggregate({
        where: { brain: { access: { some: { userId } } } },
        _sum: { sizeBytes: true },
      });
      total += agg._sum.sizeBytes ?? 0;
    } catch {
      // See countUserBrains — failure-open on unreachable tenants.
    }
  }
  return total;
}
