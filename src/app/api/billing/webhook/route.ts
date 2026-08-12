import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  applySubscription,
  isBillingConfigured,
  stripe,
  subjectFrom,
  syncSeatsToStripe,
} from "@/lib/billing";

export const runtime = "nodejs";

/**
 * POST /api/billing/webhook
 *
 * The only writer of billing-derived entitlement. Checkout returning a
 * success URL is not proof of payment — the browser can be closed, replayed,
 * or forged — so the client-side return is cosmetic and everything real
 * happens here.
 *
 * Three properties this handler has to hold:
 *
 *  1. Signature verified against the RAW body. Any re-serialisation (calling
 *     `req.json()` and stringifying it back) changes the bytes and breaks the
 *     HMAC, so the body is read once, as text, and never parsed by us.
 *  2. Idempotent. Stripe delivers at least once and retries for three days;
 *     a duplicate `customer.subscription.deleted` must not downgrade someone
 *     who has since resubscribed.
 *  3. Convergent, not incremental. Handlers re-fetch the subscription and
 *     derive the target state from that current snapshot rather than from
 *     the event payload or by nudging what's stored, so out-of-order
 *     delivery settles on Stripe's actual state instead of oscillating.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isBillingConfigured() || !secret) {
    return NextResponse.json({ error: "billing_unavailable" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    // 400, never 500: a bad signature is the caller's problem and Stripe
    // should not retry it.
    logger.warn({ err }, "[billing] webhook signature verification failed");
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // Resolve the subscription BEFORE opening a transaction. Some events carry
  // only an id, and holding a Postgres transaction open across a round trip
  // to Stripe would pin a pooled connection for the duration of that call.
  let subscription: Stripe.Subscription | null;
  try {
    subscription = await resolveSubscription(event);
  } catch (err) {
    logger.error(
      { err, eventId: event.id, type: event.type },
      "[billing] could not resolve subscription for event",
    );
    return NextResponse.json({ error: "resolve_failed" }, { status: 500 });
  }

  if (!subscription) {
    // Event type we don't act on, or one with nothing to apply. Record
    // nothing and acknowledge — Stripe only needs a 2xx.
    return NextResponse.json({ received: true, applied: false });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Insert the marker FIRST. If this event has already been handled the
      // unique index rejects it here, before any entitlement is touched, and
      // the whole transaction unwinds.
      await tx.processedStripeEvent.create({
        data: { id: event.id, type: event.type },
      });
      await applySubscription(subscription, tx);
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      isDuplicateEventMarker(err)
    ) {
      return NextResponse.json({ received: true, duplicate: true });
    }
    // 500 so Stripe retries. Anything transient (a tenant blip, a lock
    // timeout) gets another chance rather than silently losing an upgrade.
    logger.error(
      { err, eventId: event.id, type: event.type },
      "[billing] webhook handler failed",
    );
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  // Renewal doubles as seat reconciliation. A seat sync that failed on a
  // membership change only retries on the NEXT membership change, so a
  // quiescent org would otherwise carry the drift indefinitely; recounting
  // here bounds it to one billing cycle. Runs after the transaction commits
  // (it makes its own Stripe round trip) and never throws.
  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed"
  ) {
    const subject = subjectFrom(subscription);
    if (subject?.type === "organization") {
      await syncSeatsToStripe(subject.id);
    }
  }

  logger.info(
    { eventId: event.id, type: event.type, subscriptionId: subscription.id },
    "[billing] webhook applied",
  );
  return NextResponse.json({ received: true, applied: true });
}

/**
 * Whether a P2002 out of the handler transaction came from the
 * ProcessedStripeEvent primary key, meaning "this event id was already
 * handled". The same transaction also writes the unique
 * `stripe_subscription_id` columns on user/organization, and a collision
 * there is a real failure that must hit the 500-and-retry path; treating
 * every P2002 as a duplicate would ack it and permanently drop the event.
 * Prisma reports the violated constraint as the model plus field list when
 * it can map the constraint back, or as the raw constraint name otherwise.
 */
function isDuplicateEventMarker(
  err: Prisma.PrismaClientKnownRequestError,
): boolean {
  const meta = err.meta as
    | { modelName?: string; target?: unknown }
    | undefined;
  if (typeof meta?.modelName === "string") {
    return meta.modelName === "ProcessedStripeEvent";
  }
  const target = meta?.target;
  // The migration names the PK `processed_stripe_event_pkey`, and `id` is
  // the only unique field the marker insert can violate; the subscription-id
  // columns never appear under either shape.
  if (typeof target === "string") {
    return target.startsWith("processed_stripe_event");
  }
  if (Array.isArray(target)) return target.includes("id");
  return false;
}

/**
 * Reduce every event we subscribe to down to the subscription it concerns.
 *
 * Returning null means "acknowledge and do nothing", which is the correct
 * response to an event type Stripe sends that we haven't opted into acting on.
 */
async function resolveSubscription(
  event: Stripe.Event,
): Promise<Stripe.Subscription | null> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      // The payload is only a snapshot from when the event was GENERATED,
      // and Stripe guarantees neither ordering nor single delivery: applied
      // directly, a stale "active" snapshot landing after the deletion event
      // would re-grant a dead plan. Re-fetch current state instead, exactly
      // like the checkout and invoice branches below. A canceled
      // subscription still retrieves (status "canceled"), so the deleted
      // case needs no special path; a retrieve failure propagates to the
      // 500-and-retry path.
      return stripe().subscriptions.retrieve(event.data.object.id);

    case "checkout.session.completed": {
      const session = event.data.object;
      const id = idOf(session.subscription);
      // A one-off (non-subscription) Checkout Session has no subscription.
      return id ? await stripe().subscriptions.retrieve(id) : null;
    }

    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      // `invoice.subscription` was removed from the Invoice object; the link
      // now hangs off the invoice's parent. Reading the old field would
      // silently yield undefined and skip every renewal.
      const details =
        invoice.parent?.type === "subscription_details"
          ? invoice.parent.subscription_details
          : null;
      const id = idOf(details?.subscription);
      return id ? await stripe().subscriptions.retrieve(id) : null;
    }

    default:
      return null;
  }
}

/** Stripe fields are `string | ExpandedObject | null` depending on expansion. */
function idOf(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}
