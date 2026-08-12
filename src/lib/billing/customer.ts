/**
 * Stripe Customer lifecycle.
 *
 * A customer is created lazily on the first checkout or portal visit rather
 * than at signup, so the vast majority of users who never pay never appear in
 * Stripe at all.
 */
import { prisma } from "@/lib/db";
import { stripe } from "./stripe";
import { SUBJECT_ID_KEY, SUBJECT_TYPE_KEY } from "./subscription";
import type { BillingSubject } from "./subscription";

/**
 * Return the Stripe customer id for a subject, creating it if needed.
 *
 * The Stripe call carries an idempotency key derived from the subject, which
 * collapses the double-click case: two concurrent checkout attempts return
 * the same customer instead of creating a duplicate that would then race to
 * win the unique index on `stripe_customer_id`.
 */
export async function ensureCustomer(
  subject: BillingSubject,
): Promise<string> {
  const existing = await readCustomerId(subject);
  if (existing) return existing;

  const client = stripe();
  const details = await describeSubject(subject);

  const customer = await client.customers.create(
    {
      email: details.email,
      name: details.name,
      metadata: {
        [SUBJECT_TYPE_KEY]: subject.type,
        [SUBJECT_ID_KEY]: subject.id,
      },
    },
    { idempotencyKey: `aju-customer-${subject.type}-${subject.id}` },
  );

  if (subject.type === "user") {
    await prisma.user.update({
      where: { id: subject.id },
      data: { stripeCustomerId: customer.id },
    });
  } else {
    await prisma.organization.update({
      where: { id: subject.id },
      data: { stripeCustomerId: customer.id },
    });
  }
  return customer.id;
}

async function readCustomerId(
  subject: BillingSubject,
): Promise<string | null> {
  if (subject.type === "user") {
    const row = await prisma.user.findUnique({
      where: { id: subject.id },
      select: { stripeCustomerId: true },
    });
    return row?.stripeCustomerId ?? null;
  }
  const row = await prisma.organization.findUnique({
    where: { id: subject.id },
    select: { stripeCustomerId: true },
  });
  return row?.stripeCustomerId ?? null;
}

/**
 * Name and email to put on the Stripe customer.
 *
 * An org bills to its owner's email: orgs have no address of their own, and
 * the owner is the person who agreed to pay. Members changing later doesn't
 * move the invoice.
 */
async function describeSubject(
  subject: BillingSubject,
): Promise<{ email: string | undefined; name: string | undefined }> {
  if (subject.type === "user") {
    const user = await prisma.user.findUnique({
      where: { id: subject.id },
      select: { email: true, name: true },
    });
    return { email: user?.email, name: user?.name || undefined };
  }
  const org = await prisma.organization.findUnique({
    where: { id: subject.id },
    select: { name: true, owner: { select: { email: true } } },
  });
  return { email: org?.owner?.email, name: org?.name };
}
