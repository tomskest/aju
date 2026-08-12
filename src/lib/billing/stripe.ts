/**
 * Stripe client singleton.
 *
 * Instantiated lazily rather than at module load so that importing anything
 * from `@/lib/billing` (the barrel pulls in plan-limits, which every write
 * route touches) doesn't hard-fail a deployment that hasn't set the Stripe
 * env yet. Billing is additive: an unconfigured instance still serves reads
 * and writes, it just can't sell anything.
 */
import Stripe from "stripe";

/**
 * Pinned deliberately, not left to the SDK default. The SDK's default tracks
 * whatever version it shipped with, so a routine `npm update stripe` would
 * silently move the wire format under us. Bump this only alongside a
 * deliberate read of the API changelog.
 */
const API_VERSION = "2026-07-29.dahlia" as const;

let cached: Stripe | null = null;

export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set — billing routes are unavailable.",
    );
  }
  cached = new Stripe(key, {
    apiVersion: API_VERSION,
    appInfo: { name: "aju", url: "https://aju.sh" },
    // Stripe's own retry logic, for network blips and 5xx only. Requests we
    // send with an idempotency key are safe to retry; the SDK attaches one
    // automatically to every POST.
    maxNetworkRetries: 2,
  });
  return cached;
}

/**
 * Whether to ask Stripe to calculate tax on Checkout Sessions.
 *
 * Off by default and gated on an explicit env flag because enabling
 * `automatic_tax` without an active Tax registration is silent: Stripe
 * calculates zero tax, returns no error, and the resulting transactions
 * cannot be corrected retroactively. Flip this to true only after a
 * registration shows as "Collecting" in Dashboard → Tax → Locations.
 */
export function automaticTaxEnabled(): boolean {
  return process.env.STRIPE_AUTOMATIC_TAX === "true";
}

/** Absolute base URL for building Checkout return URLs. */
export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}
