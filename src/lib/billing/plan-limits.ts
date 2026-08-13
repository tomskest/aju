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
 * cap.
 *
 * ## What a cap is scoped to
 *
 * Every durable resource (brain, document, file) lives in exactly one org's
 * tenant DB, so caps on those are resolved against the ORG, not the caller:
 *
 *     effectiveTierForOrg(org) = org is on Team  ? "team"
 *                                                : the org owner's user tier
 *
 * That fallback is what makes the two billing subjects compose. Pro is bought
 * by a User and funds every org that user owns (their personal org, plus any
 * shared org they created that isn't on Team). Team is bought by an Org and
 * covers everyone working inside it.
 *
 * Resolving per-org rather than per-user is deliberate, and closes a leak the
 * obvious `max(userTier, anyOrgTier)` formulation has: under that rule, buying
 * a single Team seat in someone else's org would silently raise the caps on
 * your own personal brains. Here a Team subscription raises caps only inside
 * the org that pays for it.
 *
 * API keys are the one exception — see `bestTierForUser`.
 */
import { NextResponse } from "next/server";
import type {
  PrismaClient as PrismaClientTenant,
  Prisma as PrismaTenant,
} from "@prisma/client-tenant";
import { prisma, tenantDbFor } from "@/lib/db";
import { appUrl } from "./stripe";
import { TIER_LABELS } from "./tiers";

/**
 * Stand-in for "no cap". A real number rather than Infinity because these
 * values are serialised into API responses and `JSON.stringify(Infinity)`
 * is `null`, which every client would then have to special-case. It must sit
 * strictly above every finite cap in PLAN_LIMITS, storage included (the byte
 * caps run into the hundreds of billions), or `isUnlimited` starts calling
 * real caps unlimited on the usage page.
 */
export const UNLIMITED = Number.MAX_SAFE_INTEGER;

export function isUnlimited(value: number): boolean {
  return value >= UNLIMITED;
}

/**
 * Fraction of a cap at which write paths start warning, while still allowing
 * the write. A hard 402 is the worst possible moment to first mention that a
 * plan exists: the caller has already composed the document. Warning early
 * lets an agent raise it mid-flow, when the user is not blocked.
 */
export const WARN_AT = 0.8;

export type LimitStatus = {
  limit: HardCap;
  current: number;
  max: number;
  planTier: PlanTier;
  /** The cap is hit: the write must be refused. */
  reached: boolean;
  /** At or past WARN_AT but still under the cap: the write proceeds. */
  warning: boolean;
  /** The tier worth suggesting, or null when there is nothing better to sell. */
  recommendedTier: PaidTier | null;
  /**
   * One line, written to be read by a person or relayed by an agent.
   *
   * It names the tier to buy and carries an absolute URL, because an MCP
   * client has no origin to resolve `/pricing` against, and it stays short
   * enough to survive the CLI's 256-character error snippet.
   */
  message: string;
};

/**
 * Raised by write paths that are not HTTP routes (the MCP tools), so the
 * caller can render a structured tool error rather than a bare string.
 */
export class PlanLimitError extends Error {
  constructor(readonly status: LimitStatus) {
    super(status.message);
    this.name = "PlanLimitError";
  }
}

export const PLAN_LIMITS = {
  // Internal tier for founders / operators. Not self-assignable — flip a
  // user's plan_tier column directly in the control DB. Held at or above
  // every paid tier on every axis so that `bestTierForUser` ranking stays
  // truthful: an operator sitting in a Team org must never come out worse
  // off than the members they support.
  beta_founder: {
    brains: UNLIMITED,
    documentsPerBrain: 100_000,
    apiKeysMax: 250,
    searchesPerMonth: 1_000_000,
    embeddingTokensPerMonth: 100_000_000,
    storageBytesMax: 268_435_456_000, // 250 GiB
  },
  // Per-seat plan, bought by an Organization.
  team: {
    brains: UNLIMITED,
    documentsPerBrain: 100_000,
    apiKeysMax: 250,
    searchesPerMonth: 1_000_000,
    embeddingTokensPerMonth: 100_000_000,
    storageBytesMax: 268_435_456_000, // 250 GiB, pooled across the org
  },
  // Personal paid plan, bought by a User.
  pro: {
    brains: 20,
    documentsPerBrain: 20_000,
    apiKeysMax: 50,
    searchesPerMonth: 100_000,
    embeddingTokensPerMonth: 10_000_000,
    storageBytesMax: 26_843_545_600, // 25 GiB
  },
  // Closed-beta cohort. Free forever: these users were here first and never
  // agreed to a price. Retained as a live tier indefinitely rather than being
  // migrated onto `free`, which would strand them far over cap.
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
/** The tiers a customer can actually buy. */
export type PaidTier = "pro" | "team";

type HardCap = "brains" | "documentsPerBrain" | "apiKeysMax" | "storageBytesMax";

/**
 * Ordering used when a principal is covered by more than one tier at once.
 * Monotonic: a higher rank is at least as generous on every axis, which is
 * what lets `bestTierForUser` pick by rank instead of comparing field by
 * field. Keep it that way when adding a tier.
 */
const TIER_RANK: Record<PlanTier, number> = {
  free: 0,
  beta_legacy: 1,
  pro: 2,
  team: 3,
  beta_founder: 4,
};

export function isPaidTier(tier: string): tier is PaidTier {
  return tier === "pro" || tier === "team";
}

export function limitsFor(planTier: string | null | undefined): PlanLimits {
  if (planTier && planTier in PLAN_LIMITS) {
    return PLAN_LIMITS[planTier as PlanTier];
  }
  return PLAN_LIMITS.free;
}

function normalizeTier(planTier: string | null | undefined): PlanTier {
  return planTier && planTier in PLAN_LIMITS ? (planTier as PlanTier) : "free";
}

/**
 * The tier governing everything stored inside one org.
 *
 * Entitlement reads from `planTier` alone, never from `subscriptionStatus`.
 * The webhook owns `planTier` and moves it only on a settled lifecycle event,
 * so a card that fails at 3am doesn't lock a team out of their notes while
 * Stripe is still retrying it. Dunning is a billing state, not an access one.
 */
export async function effectiveTierForOrg(
  organizationId: string,
): Promise<PlanTier> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { planTier: true, owner: { select: { planTier: true } } },
  });
  if (!org) return "free";
  if (org.planTier === "team") return "team";
  return normalizeTier(org.owner?.planTier);
}

export async function effectiveLimitsForOrg(
  organizationId: string,
): Promise<PlanLimits> {
  return PLAN_LIMITS[await effectiveTierForOrg(organizationId)];
}

/**
 * The most generous tier a user is covered by anywhere.
 *
 * Used ONLY for the API-key cap. Keys are control-plane rows that belong to
 * the user rather than to any one org, and the count spans every org they
 * work in, so scoping them to a single org would be arbitrary. Granting the
 * best-of tier here is safe in a way it would not be for storage: a key is a
 * credential, not a resource, and the caps it unlocks are still enforced
 * per-org at the point the key is used.
 */
export async function bestTierForUser(userId: string): Promise<PlanTier> {
  const [user, teamOrgs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { planTier: true },
    }),
    prisma.organizationMembership.count({
      where: { userId, organization: { planTier: "team" } },
    }),
  ]);
  const own = normalizeTier(user?.planTier);
  if (teamOrgs === 0) return own;
  return TIER_RANK[own] >= TIER_RANK.team ? own : "team";
}

const LIMIT_NOUNS: Record<HardCap, string> = {
  brains: "brains",
  documentsPerBrain: "documents in this brain",
  apiKeysMax: "API keys",
  storageBytesMax: "storage",
};

/** Storage reads as bytes; everything else is a plain count. */
function formatAmount(limit: HardCap, value: number): string {
  if (limit !== "storageBytesMax") return value.toLocaleString("en-US");
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
}

export function pricingUrl(): string {
  return `${appUrl()}/pricing`;
}

/**
 * The tier worth suggesting next, given the current tier and whether the
 * resource lives in a shared org.
 *
 * A cap hit inside a shared org recommends Team, not Pro: Pro is bought by a
 * user and funds only the orgs that user owns, so selling it to someone
 * working in a shared org would not raise the cap they just hit. Checkout
 * enforces the mirror image of this rule and refuses Team on a personal org,
 * which is why Pro on a personal org has nothing above it to sell.
 */
export function nextTierFor(
  tier: PlanTier,
  sharedOrg: boolean,
): PaidTier | null {
  if (tier === "team" || tier === "beta_founder") return null;
  if (tier === "pro") return sharedOrg ? "team" : null;
  return sharedOrg ? "team" : "pro";
}

async function recommendTier(
  tier: PlanTier,
  organizationId?: string,
): Promise<PaidTier | null> {
  if (tier === "team" || tier === "beta_founder") return null;

  const sharedOrg = organizationId
    ? await prisma.organization
        .findUnique({
          where: { id: organizationId },
          select: { isPersonal: true },
        })
        .then((org) => org !== null && !org.isPersonal)
        .catch(() => false)
    : false;

  return nextTierFor(tier, sharedOrg);
}

/**
 * Assemble the status for one cap, including the sentence the API hands back.
 *
 * `organizationId` is only used to choose between Pro and Team, and is looked
 * up lazily: it costs one control-plane query, and only on the paths that are
 * already at or near a cap.
 */
async function buildStatus(
  limit: HardCap,
  current: number,
  max: number,
  planTier: PlanTier,
  organizationId?: string,
  /**
   * Storage weighs a projected total against the cap and allows a write that
   * lands exactly on it, so it passes its own verdict instead of inheriting
   * the `current >= max` rule the counted caps use.
   */
  reachedOverride?: boolean,
): Promise<LimitStatus> {
  const reached = reachedOverride ?? current >= max;
  const warning = !reached && current >= max * WARN_AT;
  const recommendedTier =
    reached || warning ? await recommendTier(planTier, organizationId) : null;

  const noun = LIMIT_NOUNS[limit];
  const tally = `${formatAmount(limit, current)}/${formatAmount(limit, max)} ${noun}`;
  const plan = TIER_LABELS[planTier];

  let message: string;
  if (recommendedTier) {
    const raisedTo = formatAmount(limit, PLAN_LIMITS[recommendedTier][limit]);
    const target = TIER_LABELS[recommendedTier];
    message = reached
      ? `${plan} plan limit reached: ${tally}. Upgrade to ${target} at ${pricingUrl()} to raise this to ${raisedTo}, or remove unused entries.`
      : `${plan} plan: ${tally} used. Upgrade to ${target} at ${pricingUrl()} to raise this to ${raisedTo} before writes start failing.`;
  } else {
    message = reached
      ? `${plan} plan limit reached: ${tally}. Remove unused entries or contact support to raise the cap.`
      : `${plan} plan: ${tally} used.`;
  }

  return {
    limit,
    current,
    max,
    planTier,
    reached,
    warning,
    recommendedTier,
    message,
  };
}

/**
 * The 402 body. `error`, `limit`, `current`, `max`, `planTier`, and `message`
 * predate the upgrade fields and are kept exactly as they were, since the CLI
 * and any existing integration parse them.
 */
export function limitResponse(status: LimitStatus): NextResponse {
  return NextResponse.json(
    {
      error: "plan_limit_reached",
      limit: status.limit,
      current: status.current,
      max: status.max,
      planTier: status.planTier,
      message: status.message,
      upgradeTo: status.recommendedTier,
      upgradeUrl: status.recommendedTier ? pricingUrl() : null,
    },
    { status: 402 },
  );
}

/**
 * Advisory to attach to a SUCCESSFUL write when usage crosses WARN_AT, so a
 * caller (or the agent driving it) can mention the ceiling before hitting it.
 * Null when there is nothing to say.
 */
export function planNotice(status: LimitStatus | null): string | null {
  return status?.warning ? status.message : null;
}

/**
 * Enforce the brains cap for one org.
 *
 * Counts every brain in the org's tenant, not just the ones the caller can
 * see: the cap is on what the paying entity stores, so a brain another member
 * created still consumes the org's allowance.
 *
 * Fails open if the tenant is unreachable — a provisioning blip must not
 * block writes, and the alternative (failing closed) turns a single tenant
 * outage into a total write outage.
 */
export async function checkBrainsLimit(
  organizationId: string,
): Promise<LimitStatus | null> {
  const tier = await effectiveTierForOrg(organizationId);
  const max = PLAN_LIMITS[tier].brains;
  if (isUnlimited(max)) return null;

  let count: number;
  try {
    const tenant = await tenantDbFor(organizationId);
    count = await tenant.brain.count();
  } catch {
    return null;
  }
  return buildStatus("brains", count, max, tier, organizationId);
}

export async function enforceBrainsLimit(
  organizationId: string,
): Promise<NextResponse | null> {
  const status = await checkBrainsLimit(organizationId);
  return status?.reached ? limitResponse(status) : null;
}

/**
 * Enforce the API-key cap: non-revoked keys on the control DB (user-keys and
 * agent-keys minted by this user both count, matching the usage page).
 */
export async function checkApiKeysLimit(
  userId: string,
): Promise<LimitStatus | null> {
  const [tier, count] = await Promise.all([
    bestTierForUser(userId),
    prisma.apiKey.count({ where: { userId, revokedAt: null } }),
  ]);
  const max = PLAN_LIMITS[tier].apiKeysMax;
  // No org is passed: keys are user-global, so there is no single org whose
  // shape could steer the recommendation toward Team.
  return buildStatus("apiKeysMax", count, max, tier);
}

export async function enforceApiKeysLimit(
  userId: string,
): Promise<NextResponse | null> {
  const status = await checkApiKeysLimit(userId);
  return status?.reached ? limitResponse(status) : null;
}

/**
 * Enforce the per-brain document cap. Must be called inside the tenant client
 * (docs live in per-tenant DBs).
 *
 * Accepts either a tenant client or an already-open transaction client. The
 * create-route path passes its `tx` so the count uses the same connection as
 * the rest of the write — issuing a parallel non-tx `tenant.*` query against
 * a client whose interactive transaction is still open can deadlock on
 * pgbouncer-pooled Postgres (Neon), producing an unhandled throw that Next
 * surfaces as a 500 with an empty body.
 */
export async function checkDocumentsPerBrainLimit(
  tenant: PrismaClientTenant | PrismaTenant.TransactionClient,
  brainId: string,
  organizationId: string,
): Promise<LimitStatus | null> {
  const [tier, count] = await Promise.all([
    effectiveTierForOrg(organizationId),
    tenant.vaultDocument.count({ where: { brainId } }),
  ]);
  const max = PLAN_LIMITS[tier].documentsPerBrain;
  return buildStatus("documentsPerBrain", count, max, tier, organizationId);
}

export async function enforceDocumentsPerBrainLimit(
  tenant: PrismaClientTenant | PrismaTenant.TransactionClient,
  brainId: string,
  organizationId: string,
): Promise<NextResponse | null> {
  const status = await checkDocumentsPerBrainLimit(
    tenant,
    brainId,
    organizationId,
  );
  return status?.reached ? limitResponse(status) : null;
}

/**
 * Enforce the storage cap for one org, pooled across all of its brains.
 *
 * `additionalBytes` is the size of a pending upload the caller is about to
 * accept. Pass it so we reject BEFORE minting a presigned URL (saves a
 * round-trip to S3 for a write that'd be disallowed anyway).
 *
 * `tx` lets a route that already holds an open interactive transaction on
 * this org's tenant hand it in. Without it we'd call `tenantDbFor(orgId)` for
 * the same org and issue a parallel `vaultFile.aggregate(...)`, which races
 * the open tx on pgbouncer-pooled Postgres (Neon) and throws, surfacing as a
 * 500 with an empty body.
 */
export async function checkStorageLimit(
  organizationId: string,
  additionalBytes = 0,
  tx?: PrismaTenant.TransactionClient,
): Promise<LimitStatus | null> {
  const tier = await effectiveTierForOrg(organizationId);
  const max = PLAN_LIMITS[tier].storageBytesMax;

  let current: number;
  try {
    const client = tx ?? (await tenantDbFor(organizationId));
    const agg = await client.vaultFile.aggregate({
      _sum: { sizeBytes: true },
    });
    current = agg._sum.sizeBytes ?? 0;
  } catch {
    // See checkBrainsLimit: failure-open on an unreachable tenant.
    return null;
  }

  const projected = current + additionalBytes;
  return buildStatus(
    "storageBytesMax",
    projected,
    max,
    tier,
    organizationId,
    projected > max,
  );
}

export async function enforceStorageLimit(
  organizationId: string,
  additionalBytes = 0,
  tx?: PrismaTenant.TransactionClient,
): Promise<NextResponse | null> {
  const status = await checkStorageLimit(organizationId, additionalBytes, tx);
  return status?.reached ? limitResponse(status) : null;
}
