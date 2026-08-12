import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authedUserRoute } from "@/lib/route-helpers";
import { validateBody } from "@/lib/validators";
import {
  appUrl,
  automaticTaxEnabled,
  countAcceptedSeats,
  ensureCustomer,
  isBillingConfigured,
  priceIdFor,
  stripe,
  SUBJECT_ID_KEY,
  SUBJECT_TYPE_KEY,
} from "@/lib/billing";
import type { BillingSubject } from "@/lib/billing";

export const runtime = "nodejs";

const bodySchema = z.object({
  tier: z.enum(["pro", "team"]),
  interval: z.enum(["monthly", "yearly"]).default("monthly"),
  /** Required for `team`; the org that will hold the subscription. */
  organizationId: z.string().min(1).optional(),
});

/**
 * Dashboard label for comparing checkout conversion between the two flows.
 * The random suffix is fixed at author time rather than generated per request
 * — it identifies the flow, so it has to be stable across sessions to group.
 */
const INTEGRATION_ID: Record<"pro" | "team", string> = {
  pro: "aju_checkout_pro_kfmzrvtq",
  team: "aju_checkout_team_bwshdxln",
};

/**
 * POST /api/billing/checkout
 *
 * Returns `{ url }` for a Stripe Checkout Session. Pro bills the caller;
 * Team bills the named org and requires owner/admin on it.
 */
export const POST = authedUserRoute(
  async ({ req, user }) => {
    if (!isBillingConfigured()) {
      return NextResponse.json(
        { error: "billing_unavailable" },
        { status: 503 },
      );
    }

    const parsed = await validateBody(req, bodySchema);
    if (!parsed.ok) return parsed.response;
    const { tier, interval, organizationId } = parsed.value;

    // ── Resolve who is being billed, and check they're allowed to buy ──────
    let subject: BillingSubject;
    let quantity = 1;

    if (tier === "pro") {
      subject = { type: "user", id: user.id };

      const existing = await prisma.user.findUnique({
        where: { id: user.id },
        select: { planTier: true, stripeCustomerId: true },
      });
      if (
        existing?.planTier === "pro" ||
        (await hasLiveSubscription(existing?.stripeCustomerId))
      ) {
        // Already subscribed. A second Checkout Session would open a second
        // subscription on the same customer and bill twice.
        return NextResponse.json(
          { error: "already_subscribed", manageAt: "/api/billing/portal" },
          { status: 409 },
        );
      }
    } else {
      if (!organizationId) {
        return NextResponse.json(
          { error: "organization_id_required" },
          { status: 400 },
        );
      }

      const membership = await prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: { organizationId, userId: user.id },
        },
        select: { role: true, acceptedAt: true },
      });
      if (
        !membership?.acceptedAt ||
        (membership.role !== "owner" && membership.role !== "admin")
      ) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }

      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { planTier: true, isPersonal: true, stripeCustomerId: true },
      });
      if (!org) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      if (org.isPersonal) {
        // A personal org's caps come from its owner's Pro plan. Letting it
        // hold a per-seat Team subscription would bill for seats that can
        // never be filled.
        return NextResponse.json(
          { error: "personal_org_cannot_buy_team" },
          { status: 400 },
        );
      }
      if (
        org.planTier === "team" ||
        (await hasLiveSubscription(org.stripeCustomerId))
      ) {
        return NextResponse.json(
          { error: "already_subscribed", manageAt: "/api/billing/portal" },
          { status: 409 },
        );
      }

      subject = { type: "organization", id: organizationId };
      quantity = Math.max(1, await countAcceptedSeats(organizationId));
    }

    // ── Create the session ────────────────────────────────────────────────
    const customer = await ensureCustomer(subject);
    const autoTax = automaticTaxEnabled();

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      // `payment_method_types` is deliberately omitted so Stripe serves the
      // dynamic set configured in the Dashboard. Pinning it to ["card"] would
      // hide SEPA and the local methods most EU buyers reach for first.
      line_items: [{ price: priceIdFor(tier, interval), quantity }],
      integration_identifier: INTEGRATION_ID[tier],
      allow_promotion_codes: true,
      // The subject travels on the subscription itself, so every later
      // webhook can route without a reverse lookup from the customer id.
      subscription_data: {
        metadata: {
          [SUBJECT_TYPE_KEY]: subject.type,
          [SUBJECT_ID_KEY]: subject.id,
        },
      },
      metadata: {
        [SUBJECT_TYPE_KEY]: subject.type,
        [SUBJECT_ID_KEY]: subject.id,
      },
      ...(autoTax
        ? {
            automatic_tax: { enabled: true },
            tax_id_collection: { enabled: true },
            // Let Checkout write the address it collects back to the
            // customer; without this an existing customer's stale saved
            // address wins and tax is computed for the wrong country.
            customer_update: { address: "auto" as const },
          }
        : {}),
      // Stripe's minimum lifetime; the default is 24 hours. The planTier
      // guards above are check-then-act against a column only the webhook
      // writes, so a session abandoned in a tab stays completable after a
      // SECOND session has been paid for, stacking two subscriptions on one
      // customer. Shrinking the window doesn't close that race, but it turns
      // "any time today" into "within half an hour".
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      success_url: `${appUrl()}/app/usage?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/pricing?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  },
  // Billing is a human decision: an agent key must never be able to open a
  // payment flow on the minting user's card, whatever scopes it carries.
  { requiresScope: "write", humanOnly: true },
);

/**
 * Stripe-side duplicate guard, complementing the planTier checks above.
 * `planTier` is written only by the webhook, so between a completed payment
 * and its webhook landing the DB still reads "not subscribed" and would let
 * a second session through; asking Stripe directly closes that window. A
 * subject with no stored customer id has never reached Checkout and cannot
 * hold a subscription, so the check is skipped.
 */
async function hasLiveSubscription(
  customerId: string | null | undefined,
): Promise<boolean> {
  if (!customerId) return false;
  const subs = await stripe().subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  return subs.data.some(
    (s) =>
      s.status === "active" ||
      s.status === "trialing" ||
      s.status === "past_due",
  );
}
