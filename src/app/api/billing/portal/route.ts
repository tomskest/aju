import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authedUserRoute } from "@/lib/route-helpers";
import { validateBody } from "@/lib/validators";
import {
  appUrl,
  isBillingConfigured,
  portalConfigFor,
  stripe,
} from "@/lib/billing";

export const runtime = "nodejs";

const bodySchema = z.object({
  /** Omit to manage your own Pro plan; pass an org id to manage its Team plan. */
  organizationId: z.string().min(1).optional(),
});

/**
 * POST /api/billing/portal
 *
 * Returns `{ url }` for a Stripe Customer Portal session — the self-service
 * surface for changing card, switching monthly/yearly, downloading invoices,
 * and cancelling. We deliberately don't rebuild any of that ourselves.
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
    const { organizationId } = parsed.value;

    let customerId: string | null;
    let configuration: string;
    let returnTo: string;

    if (organizationId) {
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
        select: { stripeCustomerId: true },
      });
      customerId = org?.stripeCustomerId ?? null;
      configuration = portalConfigFor("team");
      returnTo = `${appUrl()}/app/orgs/${organizationId}/settings`;
    } else {
      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { stripeCustomerId: true },
      });
      customerId = row?.stripeCustomerId ?? null;
      configuration = portalConfigFor("pro");
      returnTo = `${appUrl()}/app/usage`;
    }

    // No customer means they've never checked out. Sending them to the portal
    // would 500 inside Stripe; the honest answer is "there's nothing to
    // manage yet, go buy something".
    if (!customerId) {
      return NextResponse.json(
        { error: "no_subscription", startAt: "/pricing" },
        { status: 404 },
      );
    }

    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnTo,
      configuration,
    });

    return NextResponse.json({ url: session.url });
  },
  // Billing is a human decision: the portal can cancel the subscription and
  // swap the payment method, so agent keys are rejected outright.
  { requiresScope: "write", humanOnly: true },
);
