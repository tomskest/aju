/**
 * Translating a Stripe subscription into an aju entitlement.
 *
 * This is the only place `plan_tier` is written as a result of billing. The
 * webhook calls `applySubscription` inside the same transaction that records
 * the event id, so an entitlement change and its idempotency marker commit or
 * roll back together.
 */
import Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isBillingConfigured, stripe } from "./stripe";
import { tierForPriceId } from "./catalog";

/** Control-plane client or an open interactive transaction on it. */
type Db = typeof prisma | Prisma.TransactionClient;

export type BillingSubject = {
  type: "user" | "organization";
  id: string;
};

/**
 * Subscription metadata keys. Set on `subscription_data.metadata` at Checkout
 * so that every later webhook can route itself from the subscription alone.
 * This metadata is the ONLY resolution path: there is no reverse lookup from
 * the customer id, so a subscription created by hand in the Dashboard without
 * these keys is ignored by design (logged and acknowledged, never guessed at).
 * Operators creating one must set both keys on the subscription themselves.
 */
export const SUBJECT_TYPE_KEY = "aju_subject_type";
export const SUBJECT_ID_KEY = "aju_subject_id";

/**
 * Statuses that keep a customer entitled.
 *
 * `past_due` is deliberately included. Stripe keeps retrying a failed payment
 * for weeks, and revoking access on the first decline would lock a paying
 * team out of their own notes over an expired card. Access ends when Stripe
 * says the subscription is genuinely over, not when a charge bounces.
 */
const GRANTING: ReadonlySet<Stripe.Subscription.Status> = new Set([
  "active",
  "trialing",
  "past_due",
]);

/**
 * Statuses that end entitlement. `incomplete` is in neither set: it means the
 * very first payment hasn't succeeded yet, so there is nothing to grant and
 * nothing to take away.
 */
const REVOKING: ReadonlySet<Stripe.Subscription.Status> = new Set([
  "canceled",
  "unpaid",
  "incomplete_expired",
  "paused",
]);

export function subjectFrom(
  sub: Stripe.Subscription,
): BillingSubject | null {
  const type = sub.metadata?.[SUBJECT_TYPE_KEY];
  const id = sub.metadata?.[SUBJECT_ID_KEY];
  if (!id) return null;
  if (type !== "user" && type !== "organization") return null;
  return { type, id };
}

/**
 * The period end for a subscription.
 *
 * Read from the first subscription ITEM, not the subscription. Stripe moved
 * `current_period_start/end` off the Subscription object onto its items, so
 * the top-level field older integrations read no longer exists and would
 * silently land as null here.
 */
function periodEnd(sub: Stripe.Subscription): Date | null {
  const seconds = sub.items?.data?.[0]?.current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

/**
 * When a scheduled cancellation takes effect, or null if none is scheduled.
 *
 * Usually equal to the period end, but not necessarily: `cancel_at` can be
 * set to an arbitrary future date through the API, and then access ends on
 * that date rather than at the end of the paid period.
 */
function cancelDate(sub: Stripe.Subscription): Date | null {
  const seconds = sub.cancel_at;
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

function priceIdOf(sub: Stripe.Subscription): string | null {
  return sub.items?.data?.[0]?.price?.id ?? null;
}

/**
 * Pull a subscription's current state from Stripe and apply it.
 *
 * The mirror only moves when a webhook arrives, so a mapping gap or a missed
 * delivery leaves it stale until the next lifecycle event, which can be a
 * month away. Calling this from a surface that renders billing state makes
 * that drift self-correcting instead of permanent.
 *
 * Throws on a Stripe failure or an unmapped price; callers rendering a page
 * should catch and fall back to the stored values rather than 500.
 */
export async function reconcileSubscription(
  subscriptionId: string,
  db: Db = prisma,
): Promise<void> {
  await applySubscription(
    await stripe().subscriptions.retrieve(subscriptionId),
    db,
  );
}

/**
 * Apply a subscription's current state to the entitlement it governs.
 *
 * Safe to call repeatedly with the same subscription: it derives the target
 * state from the payload rather than mutating relative to what's stored, so
 * out-of-order webhook delivery converges instead of oscillating.
 */
export async function applySubscription(
  sub: Stripe.Subscription,
  db: Db = prisma,
): Promise<void> {
  const subject = subjectFrom(sub);
  if (!subject) {
    logger.error(
      { subscriptionId: sub.id, metadata: sub.metadata },
      "[billing] subscription has no aju subject metadata — ignoring",
    );
    return;
  }

  const priceId = priceIdOf(sub);
  const tier = priceId ? tierForPriceId(priceId) : null;

  if (GRANTING.has(sub.status) && !tier) {
    // Money is moving for a price we don't recognise. Do NOT downgrade — this
    // is far more likely to be a price added in the Dashboard that never got
    // wired into env than a signal to revoke. Throw rather than swallow: the
    // webhook 500s, the event marker rolls back, and Stripe keeps retrying
    // for days, so fixing the STRIPE_PRICE_* env self-heals the grant. Acking
    // instead would commit the marker and permanently discard the event.
    logger.error(
      { subscriptionId: sub.id, priceId },
      "[billing] active subscription on an unmapped price — entitlement unchanged",
    );
    throw new Error(
      `unmapped price ${priceId ?? "(none)"} on active subscription ${sub.id}`,
    );
  }

  const cancelAt = cancelDate(sub);
  const bookkeeping = {
    stripeSubscriptionId: sub.id,
    subscriptionStatus: sub.status,
    currentPeriodEnd: periodEnd(sub),
    // Both signals, because Stripe is mid-migration between them: current API
    // versions record a cancel-at-period-end as `cancel_at` and leave the
    // boolean false. Reading only the boolean makes a subscription that is
    // winding down look like one that renews.
    cancelAtPeriodEnd: (sub.cancel_at_period_end ?? false) || cancelAt !== null,
    cancelAt,
  };

  if (subject.type === "user") {
    await applyToUser(db, subject.id, sub, tier, bookkeeping);
  } else {
    await applyToOrg(db, subject.id, sub, tier, bookkeeping);
  }
}

type Bookkeeping = {
  stripeSubscriptionId: string;
  subscriptionStatus: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
};

async function applyToUser(
  db: Db,
  userId: string,
  sub: Stripe.Subscription,
  tier: string | null,
  bookkeeping: Bookkeeping,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      planTier: true,
      grandfatheredAt: true,
      stripeSubscriptionId: true,
    },
  });
  if (!user) {
    logger.error({ userId, subscriptionId: sub.id }, "[billing] unknown user");
    return;
  }

  // Only the subscription on record may revoke. A revoking event can arrive
  // for a DIFFERENT subscription than the one entitlement was granted from
  // (a late-delivered `deleted` for a replaced subscription, or support
  // cancelling a duplicate), and acting on it would strip a tier the
  // surviving subscription is still paying for. A null stored id is a
  // non-match too. Granting stays last-write-wins.
  if (REVOKING.has(sub.status) && user.stripeSubscriptionId !== sub.id) {
    logger.warn(
      {
        userId,
        subscriptionId: sub.id,
        storedSubscriptionId: user.stripeSubscriptionId,
      },
      "[billing] ignoring revoking event for a subscription not on record",
    );
    return;
  }

  let planTier = user.planTier;
  if (GRANTING.has(sub.status) && tier === "pro") {
    planTier = "pro";
  } else if (REVOKING.has(sub.status)) {
    // Only ever unwind a tier that billing itself granted. An operator on
    // `beta_founder` who trials Pro and cancels must not be dropped to free,
    // and a grandfathered user falls back to the cohort they came in on
    // rather than to the much tighter `free` caps.
    if (user.planTier === "pro") {
      planTier = user.grandfatheredAt ? "beta_legacy" : "free";
    }
  }

  await db.user.update({
    where: { id: userId },
    data: { ...bookkeeping, planTier },
  });
}

async function applyToOrg(
  db: Db,
  organizationId: string,
  sub: Stripe.Subscription,
  tier: string | null,
  bookkeeping: Bookkeeping,
): Promise<void> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { planTier: true, stripeSubscriptionId: true },
  });
  if (!org) {
    logger.error(
      { organizationId, subscriptionId: sub.id },
      "[billing] unknown organization",
    );
    return;
  }

  // Same guard as applyToUser: only the subscription on record may revoke.
  if (REVOKING.has(sub.status) && org.stripeSubscriptionId !== sub.id) {
    logger.warn(
      {
        organizationId,
        subscriptionId: sub.id,
        storedSubscriptionId: org.stripeSubscriptionId,
      },
      "[billing] ignoring revoking event for a subscription not on record",
    );
    return;
  }

  let planTier = org.planTier;
  if (GRANTING.has(sub.status) && tier === "team") {
    planTier = "team";
  } else if (REVOKING.has(sub.status) && org.planTier === "team") {
    // Back to "free" rather than to a cap of its own: a non-Team org inherits
    // its owner's tier via effectiveTierForOrg, so the members keep whatever
    // the owner personally pays for instead of falling off a cliff.
    planTier = "free";
  }

  const seats = sub.items?.data?.[0]?.quantity;
  await db.organization.update({
    where: { id: organizationId },
    data: {
      ...bookkeeping,
      planTier,
      ...(typeof seats === "number" ? { seatCount: seats } : {}),
    },
  });
}

/** Accepted members of an org — the seat count we bill for. */
export async function countAcceptedSeats(
  organizationId: string,
): Promise<number> {
  return prisma.organizationMembership.count({
    where: { organizationId, acceptedAt: { not: null } },
  });
}

/**
 * Push the org's true seat count to Stripe.
 *
 * Called after any membership change. No-ops unless the org actually holds a
 * Team subscription, so invites inside a free org cost nothing. Quantity is
 * floored at 1 because Stripe rejects a zero-quantity licensed item, and an
 * org that has removed its last member still has an owner to bill.
 *
 * Deliberately never throws to its caller: a membership change must succeed
 * even if Stripe is unreachable. Drift is recoverable on two paths. First,
 * `seatCount` is only written after Stripe confirms, so a failed sync leaves
 * the stored value stale (stale-high when the failed change was a removal,
 * which is the overbilling direction) and the next membership change retries
 * it. Second, the webhook re-runs this sync on every `invoice.*` event for an
 * org subject, so a membership-quiescent org reconciles at the latest on its
 * next billing cycle.
 */
export async function syncSeatsToStripe(
  organizationId: string,
): Promise<void> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeSubscriptionId: true, planTier: true, seatCount: true },
    });
    if (!org?.stripeSubscriptionId || org.planTier !== "team") return;

    const seats = Math.max(1, await countAcceptedSeats(organizationId));
    if (seats === org.seatCount) return;

    const client = stripe();
    const sub = await client.subscriptions.retrieve(org.stripeSubscriptionId);
    const item = sub.items?.data?.[0];
    if (!item) return;

    await client.subscriptionItems.update(item.id, {
      quantity: seats,
      proration_behavior: "create_prorations",
    });
    await prisma.organization.update({
      where: { id: organizationId },
      data: { seatCount: seats },
    });
    logger.info(
      { organizationId, seats, from: org.seatCount },
      "[billing] seat count synced",
    );
  } catch (err) {
    logger.error(
      { organizationId, err },
      "[billing] seat sync failed — will retry on next membership change",
    );
  }
}

/**
 * Thrown when Stripe refuses to cancel a subscription during subject
 * deletion. A distinct class so UI callers can tell "billing blocked the
 * delete" apart from infrastructure failures and say so to the user.
 */
export class SubscriptionCancelError extends Error {
  constructor(subscriptionId: string, cause: unknown) {
    super(`could not cancel Stripe subscription ${subscriptionId}`, { cause });
    this.name = "SubscriptionCancelError";
  }
}

/**
 * Cancel a subscription because its billing subject is being destroyed.
 *
 * Deleting a user or an org is the one moment where the app, not the
 * customer, has to end the subscription: once the row is gone the metadata
 * on renewal webhooks resolves to nothing, there is no login left to reach
 * the portal from, and Stripe keeps invoicing a card nobody can detach.
 * Callers run this BEFORE the destructive delete and must treat a throw as
 * "abort the deletion". A retryable failed delete beats a subscription that
 * bills forever.
 *
 * An already-canceled or missing subscription counts as success: the goal is
 * "not billing any more", and a retry after a partial teardown lands here.
 * No-ops when billing isn't configured, in which case no subscription can
 * exist to cancel.
 */
export async function cancelStripeSubscription(
  subscriptionId: string,
): Promise<void> {
  if (!isBillingConfigured()) return;
  try {
    await stripe().subscriptions.cancel(subscriptionId);
    logger.info(
      { subscriptionId },
      "[billing] subscription canceled on subject deletion",
    );
  } catch (err) {
    if (
      err instanceof Stripe.errors.StripeInvalidRequestError &&
      (err.code === "resource_missing" || /canceled/i.test(err.message))
    ) {
      return;
    }
    logger.error(
      { subscriptionId, err },
      "[billing] subscription cancel failed, aborting subject deletion",
    );
    throw new SubscriptionCancelError(subscriptionId, err);
  }
}
