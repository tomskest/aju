import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import {
  isBillingConfigured,
  PLAN_LIMITS,
  limitsFor,
  reconcileSubscription,
} from "@/lib/billing";
import { logger } from "@/lib/logger";
import ManageBillingButton from "@/components/app/ManageBillingButton";
import PlanBadge from "@/components/app/PlanBadge";

export const dynamic = "force-dynamic";

/**
 * Billing home.
 *
 * Everything mutable about a subscription (card, VAT id, monthly/yearly,
 * invoices, cancellation) lives in the Stripe Customer Portal, so this page
 * deliberately does not rebuild any of it. Its job is to state what you are
 * on, what it costs you next, and to put the portal one click from the nav
 * rather than buried behind a usage chart.
 *
 * Every field rendered here is maintained by the billing webhook on the
 * control DB, so the page costs two queries and no Stripe round-trip.
 */

type SubscriptionFields = {
  planTier: string | null;
  stripeCustomerId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
};

/** Stripe's lifecycle vocabulary, said plainly. */
const STATUS_COPY: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment overdue",
  unpaid: "Unpaid",
  canceled: "Cancelled",
  incomplete: "Awaiting payment confirmation",
  incomplete_expired: "Setup expired",
  paused: "Paused",
};

function formatDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * The one line that matters most on this page: is money moving again, and
 * when. `cancelAtPeriodEnd` outranks status because a subscription that is
 * still `active` but set to cancel is the case people most often want to
 * confirm, and getting it wrong reads as a failed cancellation.
 */
function renewalLine(sub: SubscriptionFields): string | null {
  // A scheduled cancellation ends access on `cancelAt`, which is usually the
  // period end but can be any future date when set through the API.
  const windingDown = sub.cancelAt !== null || sub.cancelAtPeriodEnd;
  const ends = formatDate(sub.cancelAt ?? sub.currentPeriodEnd);
  const periodEnd = formatDate(sub.currentPeriodEnd);

  if (windingDown) {
    return ends
      ? `Cancelled. Access ends ${ends}, with no further charges.`
      : "Cancelled. No further charges.";
  }
  if (sub.subscriptionStatus === "canceled") {
    return periodEnd ? `Ended ${periodEnd}.` : "Ended.";
  }
  if (!periodEnd) return null;
  if (sub.subscriptionStatus === "past_due" || sub.subscriptionStatus === "unpaid") {
    return `Payment failed. Stripe will retry until ${periodEnd}.`;
  }
  return `Renews ${periodEnd}.`;
}

function Panel({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  const tone = accent
    ? "border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)]"
    : "border-white/10 bg-[var(--color-panel)]/85";
  return <div className={`flex flex-col gap-4 rounded-xl border p-5 ${tone}`}>{children}</div>;
}

function CapSummary({ planTier }: { planTier: string }) {
  const limits = limitsFor(planTier);
  const brains =
    limits.brains >= Number.MAX_SAFE_INTEGER
      ? "unlimited brains"
      : `${limits.brains.toLocaleString("en-US")} brains`;
  const docs = `${limits.documentsPerBrain.toLocaleString("en-US")} documents per brain`;
  const storage =
    limits.storageBytesMax >= 1024 ** 3
      ? `${Math.round(limits.storageBytesMax / 1024 ** 3)} GB storage`
      : `${Math.round(limits.storageBytesMax / 1024 ** 2)} MB storage`;

  return (
    <p className="text-[13px] leading-6 text-[var(--color-muted)]">
      {brains}, {docs}, {storage}.{" "}
      <Link
        href="/app/usage"
        className="text-[var(--color-accent)] underline-offset-4 hover:underline"
      >
        see what you&rsquo;re using
      </Link>
    </p>
  );
}

function UpgradeLink({ label }: { label: string }) {
  return (
    <Link
      href="/pricing"
      className="inline-flex items-center justify-center rounded-lg bg-[var(--color-accent)] px-4 py-2 font-mono text-[11px] tracking-[0.2em] text-black uppercase transition-colors hover:bg-[var(--color-accent)]/85"
    >
      {label}
    </Link>
  );
}

/**
 * Everything this page renders, in two queries. Extracted so it can be run
 * again after a reconcile without restating the selects.
 */
async function loadBillingState(userId: string) {
  const [me, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        planTier: true,
        grandfatheredAt: true,
        stripeCustomerId: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        cancelAt: true,
        stripeSubscriptionId: true,
      },
    }),
    // Only owners and admins can open an org's portal session, so only they
    // are offered one here. Mirrors the check in POST /api/billing/portal.
    prisma.organizationMembership.findMany({
      where: {
        userId,
        acceptedAt: { not: null },
        role: { in: ["owner", "admin"] },
        organization: { isPersonal: false },
      },
      select: {
        organization: {
          select: {
            id: true,
            name: true,
            planTier: true,
            stripeCustomerId: true,
            subscriptionStatus: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
            cancelAt: true,
            stripeSubscriptionId: true,
            _count: { select: { memberships: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return { me, memberships };
}

export default async function BillingPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const initial = await loadBillingState(user.id);
  if (!initial.me) redirect("/");

  const billingLive = isBillingConfigured();

  // Converge the mirror before rendering it. The stored fields only move when
  // a webhook arrives, so a missed delivery or a Stripe field migration
  // leaves this page confidently wrong until the next lifecycle event, which
  // can be a month out. This is the one page where being wrong is expensive:
  // it is where someone comes to confirm that a cancellation took.
  //
  // Reconciling is idempotent by design (applySubscription derives target
  // state from Stripe rather than nudging what is stored), and a failure is
  // never fatal here: we fall back to the stored values.
  const subscriptionIds = billingLive
    ? [
        initial.me.stripeSubscriptionId,
        ...initial.memberships.map((m) => m.organization.stripeSubscriptionId),
      ].filter((id): id is string => Boolean(id))
    : [];

  let state = initial;
  if (subscriptionIds.length > 0) {
    const results = await Promise.allSettled(
      subscriptionIds.map((id) => reconcileSubscription(id)),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn(
          { err: result.reason },
          "[billing] reconcile on view failed; rendering stored state",
        );
      }
    }
    if (results.some((r) => r.status === "fulfilled")) {
      const refreshed = await loadBillingState(user.id);
      if (refreshed.me) state = { me: refreshed.me, memberships: refreshed.memberships };
    }
  }

  const me = state.me ?? initial.me;
  const memberships = state.memberships;
  const grandfathered = me.grandfatheredAt !== null;
  const planTier = me.planTier ?? "free";

  // Gated on having a Stripe customer record, NOT on the current tier. Someone
  // who cancels drops to free, and losing the portal with it would strip them
  // of their own invoices and payment history at the worst possible moment.
  const showManage = billingLive && Boolean(me.stripeCustomerId);
  const canBuyPro = planTier !== "pro" && !grandfathered;
  const personalRenewal = renewalLine(me);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <p className="font-mono text-[11px] tracking-[0.24em] text-[var(--color-muted)] uppercase">
          billing
        </p>
        <h1 className="text-[28px] leading-tight font-light tracking-[-0.02em] text-[var(--color-ink)]">
          plans and payment
        </h1>
        <p className="max-w-[560px] text-[13px] leading-6 text-[var(--color-muted)]">
          Change your card, switch between monthly and yearly, download invoices, or cancel. All of
          it opens in Stripe, which handles the payment details so we never store them.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <p className="font-mono text-[11px] tracking-[0.24em] text-[var(--color-muted)] uppercase">
          your plan
        </p>
        <Panel>
          <div className="flex flex-wrap items-center gap-3">
            <PlanBadge planTier={planTier} grandfathered={grandfathered} />
            {me.subscriptionStatus && (
              <span className="font-mono text-[11px] tracking-[0.2em] text-[var(--color-faint)] uppercase">
                {STATUS_COPY[me.subscriptionStatus] ?? me.subscriptionStatus}
              </span>
            )}
          </div>

          {grandfathered ? (
            <p className="text-[13px] leading-6 text-[var(--color-muted)]">
              You joined during the closed beta, so this plan is free permanently. Nothing to pay
              and nothing to cancel.
            </p>
          ) : (
            personalRenewal && (
              <p className="text-[13px] leading-6 text-[var(--color-ink)]">{personalRenewal}</p>
            )
          )}

          <CapSummary planTier={planTier} />

          <div className="flex flex-wrap items-center gap-3">
            {canBuyPro && <UpgradeLink label="upgrade to pro" />}
            {showManage && <ManageBillingButton label="manage subscription" />}
            <Link
              href="/pricing"
              className="font-mono text-[11px] tracking-[0.2em] text-[var(--color-muted)] uppercase underline-offset-4 hover:text-[var(--color-ink)] hover:underline"
            >
              compare plans
            </Link>
          </div>

          {!billingLive && (
            <p className="text-[11px] leading-5 text-amber-300">
              Billing is not configured on this deployment, so the portal is unavailable here.
            </p>
          )}
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <p className="font-mono text-[11px] tracking-[0.24em] text-[var(--color-muted)] uppercase">
          team plans
        </p>

        {memberships.length === 0 ? (
          <Panel>
            <p className="text-[13px] leading-6 text-[var(--color-muted)]">
              You don&rsquo;t own or administer a shared organization. Team is billed per seat to an
              organization rather than to a person, so it starts by creating one from{" "}
              <Link
                href="/app/orgs"
                className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                organizations
              </Link>
              .
            </p>
          </Panel>
        ) : (
          <div className="flex flex-col gap-3">
            {memberships.map(({ organization: org }) => {
              const orgTier = org.planTier ?? "free";
              const line = renewalLine(org);
              const seats = org._count.memberships;
              return (
                <Panel key={org.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-[15px] font-medium text-[var(--color-ink)]">
                        {org.name}
                      </h2>
                      <PlanBadge planTier={orgTier} />
                      <span className="font-mono text-[11px] text-[var(--color-faint)]">
                        {seats} {seats === 1 ? "seat" : "seats"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {orgTier !== "team" && <UpgradeLink label="upgrade to team" />}
                      {billingLive && org.stripeCustomerId && (
                        <ManageBillingButton organizationId={org.id} label="manage subscription" />
                      )}
                    </div>
                  </div>
                  {line && <p className="text-[13px] leading-6 text-[var(--color-ink)]">{line}</p>}
                  <p className="text-[12px] leading-5 text-[var(--color-muted)]">
                    Team raises this org to{" "}
                    {PLAN_LIMITS.team.documentsPerBrain.toLocaleString("en-US")} documents per brain
                    and unlimited brains, pooled across everyone in it. Seats are counted from
                    accepted members and synced to Stripe automatically.
                  </p>
                </Panel>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
