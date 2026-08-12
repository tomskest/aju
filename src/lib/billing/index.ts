/**
 * Billing domain barrel.
 *
 * Beta-cohort gating, plan-tier limit enforcement, the Stripe catalog and
 * client, and the public-email blocklist used by signup flows. Callers import
 * from `@/lib/billing` regardless of which file inside houses the symbol.
 *
 * `./stripe` is safe to re-export here even though most importers only want
 * `plan-limits`: the client is built lazily on first use, so pulling this
 * barrel into a write route doesn't require Stripe env to be present.
 */
export * from "./beta";
export * from "./plan-limits";
export * from "./public-email-blocklist";
export * from "./stripe";
export * from "./catalog";
export * from "./subscription";
export * from "./customer";
