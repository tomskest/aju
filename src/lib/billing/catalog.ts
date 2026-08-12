/**
 * Product catalog: the mapping between aju plan tiers and Stripe objects.
 *
 * One Stripe Product per tier (aju Pro, aju Team), each with a monthly and a
 * yearly Price. Tiers never share a Product — Checkout and invoices render the
 * Product name on every line item, so a shared Product would make a Pro and a
 * Team line item indistinguishable on the customer's receipt.
 *
 * Price ids come from env rather than being hardcoded so test and live mode
 * can run the same build. The reverse lookup (price → tier) is what the
 * webhook uses to decide which tier a subscription grants, so it must stay
 * exhaustive: an unmapped price id means we received money and granted
 * nothing.
 */
import type { PaidTier } from "./plan-limits";

export type BillingInterval = "monthly" | "yearly";

/** Which entity Stripe bills for a given tier. */
export const BILLING_SUBJECT: Record<PaidTier, "user" | "organization"> = {
  pro: "user",
  team: "organization",
};

const PRICE_ENV: Record<PaidTier, Record<BillingInterval, string>> = {
  pro: {
    monthly: "STRIPE_PRICE_PRO_MONTHLY",
    yearly: "STRIPE_PRICE_PRO_YEARLY",
  },
  team: {
    monthly: "STRIPE_PRICE_TEAM_MONTHLY",
    yearly: "STRIPE_PRICE_TEAM_YEARLY",
  },
};

const PORTAL_ENV: Record<PaidTier, string> = {
  pro: "STRIPE_PORTAL_CONFIG_PRO",
  team: "STRIPE_PORTAL_CONFIG_TEAM",
};

export function priceIdFor(tier: PaidTier, interval: BillingInterval): string {
  const name = PRICE_ENV[tier][interval];
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Portal configuration id for a tier.
 *
 * Two configurations exist because the portal must only offer prices the
 * customer's billing subject can actually hold: a User may switch between Pro
 * monthly and yearly, an Organization between Team monthly and yearly. A
 * single shared configuration would let a Pro user "upgrade" to a per-seat
 * Team price on their personal customer record, which our entitlement model
 * has no way to honour.
 *
 * Throws on missing env exactly like `priceIdFor`. Falling back to the
 * account's default portal configuration would silently unenforce the tier
 * isolation described above, or 500 inside Stripe on accounts that never
 * saved a default.
 */
export function portalConfigFor(tier: PaidTier): string {
  const name = PORTAL_ENV[tier];
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Reverse lookup used by the webhook: which tier does this price grant?
 *
 * Returns null for a price we don't recognise — the caller must treat that as
 * "do not change entitlement" and log loudly, never as "downgrade". An
 * unrecognised price is far more likely to be a price created in the Dashboard
 * that we haven't wired up than a genuine signal to revoke access.
 */
export function tierForPriceId(priceId: string): PaidTier | null {
  // Both sides must be non-empty before comparing. An unset env var reads as
  // "" (or undefined), and a bare equality check would then match an empty
  // price id against an unconfigured tier and grant it — turning a
  // half-configured deployment into a free upgrade.
  if (!priceId) return null;
  for (const tier of ["pro", "team"] as const) {
    for (const interval of ["monthly", "yearly"] as const) {
      const configured = process.env[PRICE_ENV[tier][interval]];
      if (configured && configured === priceId) return tier;
    }
  }
  return null;
}

/** Display metadata for the pricing page. Amounts in cents, EUR. */
export const CATALOG_DISPLAY: Record<
  PaidTier,
  { name: string; monthly: number; yearly: number; perSeat: boolean }
> = {
  pro: { name: "Pro", monthly: 2000, yearly: 20000, perSeat: false },
  team: { name: "Team", monthly: 3000, yearly: 30000, perSeat: true },
};
