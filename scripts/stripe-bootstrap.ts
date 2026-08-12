/**
 * Create (or reuse) every Stripe object aju's billing depends on.
 *
 * Stripe keeps test mode and live mode in completely separate object spaces:
 * nothing created in a sandbox exists in live mode. So this has to be run once
 * per mode, with that mode's secret key, and the four price ids it prints
 * differ between them. That is the whole reason this is a script rather than
 * a one-off session in the Dashboard.
 *
 *   STRIPE_SECRET_KEY=sk_live_... APP_URL=https://aju.sh npx tsx scripts/stripe-bootstrap.ts
 *
 * Idempotent by construction — products are keyed on `metadata.aju_tier`,
 * prices on `lookup_key`, portal configurations on `metadata.aju_kind`, and
 * the webhook endpoint on its URL. Re-running reuses what exists and only
 * creates what's missing, so it is safe to run again after a partial failure.
 *
 * The one value it cannot re-print is the webhook signing secret: Stripe
 * returns that only at creation. If the endpoint already exists and you don't
 * have the secret, roll it in the Dashboard (Developers → Webhooks → the
 * endpoint → Roll secret) and update STRIPE_WEBHOOK_SECRET.
 */
import Stripe from "stripe";

const API_VERSION = "2026-07-29.dahlia" as const;

/**
 * SaaS, business use. Governs how Stripe Tax treats the line item. Change it
 * on the Product at any time; unlike `tax_behavior` on a Price it is not
 * immutable. Confirm the choice with a tax advisor rather than trusting this
 * default.
 */
const TAX_CODE = "txcd_10103001";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set");
  process.exit(1);
}

const appUrl = (process.env.APP_URL ?? "https://aju.sh").replace(/\/$/, "");
const mode = key.startsWith("sk_live_") ? "LIVE" : "TEST";
const stripe = new Stripe(key, { apiVersion: API_VERSION });

type Tier = "pro" | "team";

const PRODUCTS: Record<Tier, { name: string; description: string }> = {
  pro: {
    name: "aju Pro",
    description:
      "Personal plan: 20 brains, 20k documents per brain, 25 GiB storage.",
  },
  team: {
    name: "aju Team",
    description:
      "Team plan, billed per seat: unlimited brains, 100k documents per brain, 250 GiB pooled storage.",
  },
};

/** Amounts in cents, EUR. Team is per seat. */
const PRICES: Array<{
  tier: Tier;
  lookupKey: string;
  amount: number;
  interval: "month" | "year";
  env: string;
}> = [
  { tier: "pro", lookupKey: "aju_pro_monthly", amount: 2000, interval: "month", env: "STRIPE_PRICE_PRO_MONTHLY" },
  { tier: "pro", lookupKey: "aju_pro_yearly", amount: 20000, interval: "year", env: "STRIPE_PRICE_PRO_YEARLY" },
  { tier: "team", lookupKey: "aju_team_monthly", amount: 3000, interval: "month", env: "STRIPE_PRICE_TEAM_MONTHLY" },
  { tier: "team", lookupKey: "aju_team_yearly", amount: 30000, interval: "year", env: "STRIPE_PRICE_TEAM_YEARLY" },
];

const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];

const out: Record<string, string> = {};

async function ensureProduct(tier: Tier): Promise<string> {
  // List + client-side metadata filter rather than products.search: the
  // Search API is eventually consistent, with up to a minute of indexing lag
  // for freshly created objects, so a re-run right after a partial failure
  // could miss the product it just created and mint a duplicate. List reads
  // are strongly consistent, matching how ensurePortal finds its
  // configurations.
  const existing = await stripe.products.list({ limit: 100 });
  const found = existing.data.find((p) => p.metadata?.aju_tier === tier);
  if (found) {
    console.log(`  reuse  product ${found.id}  (${PRODUCTS[tier].name})`);
    return found.id;
  }
  const product = await stripe.products.create({
    name: PRODUCTS[tier].name,
    description: PRODUCTS[tier].description,
    tax_code: TAX_CODE,
    metadata: { aju_tier: tier },
  });
  console.log(`  CREATE product ${product.id}  (${PRODUCTS[tier].name})`);
  return product.id;
}

async function ensurePrice(
  productId: string,
  spec: (typeof PRICES)[number],
): Promise<string> {
  const found = await stripe.prices.list({
    lookup_keys: [spec.lookupKey],
    active: true,
    limit: 1,
  });
  if (found.data[0]) {
    console.log(`  reuse  price   ${found.data[0].id}  ${spec.lookupKey}`);
    return found.data[0].id;
  }
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: spec.amount,
    currency: "eur",
    recurring: { interval: spec.interval, usage_type: "licensed" },
    // Immutable once set. "exclusive" means the listed price is net and tax is
    // added on top at checkout, which is what EU B2B buyers expect. Switching
    // to inclusive later requires creating new Price objects.
    tax_behavior: "exclusive",
    lookup_key: spec.lookupKey,
    metadata: { aju_tier: spec.tier },
  });
  console.log(
    `  CREATE price   ${price.id}  ${spec.lookupKey}  ${spec.amount / 100} EUR/${spec.interval}`,
  );
  return price.id;
}

/**
 * One portal configuration per billing subject.
 *
 * A shared configuration would let a Pro user (a User customer) switch onto a
 * per-seat Team price, which the entitlement model has no way to honour.
 * Seat quantity is intentionally not editable here: the app owns it and syncs
 * it from OrganizationMembership.
 */
async function ensurePortal(
  tier: Tier,
  headline: string,
  productId: string,
  priceIds: string[],
): Promise<string> {
  const existing = await stripe.billingPortal.configurations.list({ limit: 100 });
  const match = existing.data.find((c) => c.metadata?.aju_kind === tier);
  if (match) {
    console.log(`  reuse  portal  ${match.id}  (${tier})`);
    return match.id;
  }
  const config = await stripe.billingPortal.configurations.create({
    business_profile: { headline },
    metadata: { aju_kind: tier },
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ["email", "address", "tax_id"],
      },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: [
            "too_expensive", "missing_features", "switched_service",
            "unused", "customer_service", "too_complex", "low_quality", "other",
          ],
        },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: [{ product: productId, prices: priceIds }],
      },
    },
  });
  console.log(`  CREATE portal  ${config.id}  (${tier})`);
  return config.id;
}

async function ensureWebhook(): Promise<void> {
  const url = `${appUrl}/api/billing/webhook`;
  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  const match = existing.data.find((e) => e.url === url);
  if (match) {
    console.log(`  reuse  webhook ${match.id}  ${url}`);
    console.log(
      "         secret not retrievable for an existing endpoint — roll it in the Dashboard if unknown",
    );
    return;
  }
  const endpoint = await stripe.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: "aju billing - subscription lifecycle",
    api_version: API_VERSION,
  });
  console.log(`  CREATE webhook ${endpoint.id}  ${url}`);
  out.STRIPE_WEBHOOK_SECRET = endpoint.secret ?? "";
}

async function main() {
  console.log(`\naju Stripe bootstrap — ${mode} mode — ${appUrl}\n`);

  console.log("Products");
  const productIds = {
    pro: await ensureProduct("pro"),
    team: await ensureProduct("team"),
  } as const;

  console.log("Prices");
  const byTier: Record<Tier, string[]> = { pro: [], team: [] };
  for (const spec of PRICES) {
    const id = await ensurePrice(productIds[spec.tier], spec);
    out[spec.env] = id;
    byTier[spec.tier].push(id);
  }

  console.log("Portal configurations");
  out.STRIPE_PORTAL_CONFIG_PRO = await ensurePortal(
    "pro", "Manage your aju Pro subscription", productIds.pro, byTier.pro,
  );
  out.STRIPE_PORTAL_CONFIG_TEAM = await ensurePortal(
    "team", "Manage your aju Team subscription", productIds.team, byTier.team,
  );

  console.log("Webhook");
  await ensureWebhook();

  console.log(`\n--- ${mode} env ---`);
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
  console.log(
    "\nAlso set STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY for this mode.",
  );
  console.log(
    "Leave STRIPE_AUTOMATIC_TAX=false until a Tax registration shows as Collecting.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
