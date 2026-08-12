import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma, tenantDbFor } from "@/lib/db";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import {
  bestTierForUser,
  effectiveTierForOrg,
  isUnlimited,
  limitsFor,
  PLAN_LIMITS,
} from "@/lib/billing";
import ManageBillingButton from "@/components/app/ManageBillingButton";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Map a usage ratio to the accent/amber/red palette. Healthy is the default
 * aju green; >= 80% steps into amber, >= 95% into red.
 */
function thresholdFor(ratio: number): {
  bar: string;
  valueClass: string;
  label: string;
} {
  if (ratio >= 0.95) {
    return {
      bar: "bg-red-500",
      valueClass: "text-red-400",
      label: "at limit",
    };
  }
  if (ratio >= 0.8) {
    return {
      bar: "bg-amber-400",
      valueClass: "text-amber-300",
      label: "approaching limit",
    };
  }
  return {
    bar: "bg-[var(--color-accent)]",
    valueClass: "text-[var(--color-ink)]",
    label: "healthy",
  };
}

type TileProps = {
  label: string;
  current: number;
  limit: number;
  format: (n: number) => string;
  hint?: string;
};

function UsageTile({ label, current, limit, format, hint }: TileProps) {
  // An uncapped tier has no meaningful ratio: a progress bar pinned near zero
  // against a sentinel ceiling reads as "you have barely any headroom left"
  // when the truth is the opposite.
  const unlimited = isUnlimited(limit);
  const safeLimit = limit > 0 ? limit : 1;
  const ratio = unlimited ? 0 : Math.min(1, current / safeLimit);
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const threshold = unlimited
    ? {
        bar: "bg-[var(--color-accent)]",
        valueClass: "text-[var(--color-ink)]",
        label: "unlimited",
      }
    : thresholdFor(ratio);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          {label}
        </p>
        <span className="font-mono text-[9px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          {threshold.label}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className={`font-mono text-[22px] font-light tracking-[-0.01em] ${threshold.valueClass}`}
        >
          {format(current)}
        </span>
        <span className="font-mono text-[12px] text-[var(--color-faint)]">
          {unlimited ? "/ ∞" : `/ ${format(limit)}`}
        </span>
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full transition-all ${threshold.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {hint && (
        <p className="text-[11px] leading-5 text-[var(--color-muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}

function PlanBadge({
  planTier,
  grandfathered,
}: {
  planTier: string;
  grandfathered: boolean;
}) {
  const isBetaLegacy = planTier === "beta_legacy";
  const LABELS: Record<string, string> = {
    beta_legacy: "Beta Legacy",
    beta_founder: "Founder",
    free: "Free",
    pro: "Pro",
    team: "Team",
  };
  const label = LABELS[planTier] ?? planTier;

  // Paid and grandfathered tiers both get the accent treatment: one is earned,
  // the other is bought, and neither should read as the default state.
  const highlighted =
    isBetaLegacy || planTier === "pro" || planTier === "team";
  const tone = highlighted
    ? "border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
    : "border-white/10 bg-white/[0.04] text-[var(--color-muted)]";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] ${tone}`}
    >
      {grandfathered && <span aria-hidden>✓</span>}
      {label}
    </span>
  );
}

export default async function UsagePage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const userId = user.id;
  const grandfathered = user.grandfatheredAt !== null;

  const organizationId = await getActiveOrganizationId();

  // Caps on stored things are resolved against the ACTIVE ORG, matching what
  // enforcement actually does. Showing the user's personal tier here instead
  // would misreport the ceiling for anyone working inside a Team org.
  const orgTier = organizationId
    ? await effectiveTierForOrg(organizationId)
    : null;
  const planTier = orgTier ?? (user.planTier ?? "free");
  const limits = orgTier ? PLAN_LIMITS[orgTier] : limitsFor(user.planTier);

  // API keys are the one user-global cap, so they get their own tier.
  const keyTier = await bestTierForUser(userId);
  const apiKeysLimit = PLAN_LIMITS[keyTier].apiKeysMax;

  // Control-plane queries don't depend on a tenant client.
  const [apiKeysActive, placement] = await Promise.all([
    prisma.apiKey.count({ where: { userId, revokedAt: null } }),
    user.grandfatheredAt
      ? prisma.user.count({
          where: {
            grandfatheredAt: { not: null, lte: user.grandfatheredAt },
          },
        })
      : Promise.resolve<number | null>(null),
  ]);

  // Tenant-plane counters — the whole org's DB, not just the brains this user
  // can see. The cap is on what the paying entity stores, so a teammate's
  // brain consumes the same allowance and has to be visible in the tally.
  let documents = 0;
  let files = 0;
  let storageBytes = 0;
  let brainCount = 0;
  if (organizationId) {
    const tenant = await tenantDbFor(organizationId);
    const [d, f, fAgg, b] = await Promise.all([
      tenant.vaultDocument.count(),
      tenant.vaultFile.count(),
      tenant.vaultFile.aggregate({ _sum: { sizeBytes: true } }),
      tenant.brain.count(),
    ]);
    documents = d;
    files = f;
    storageBytes = fAgg._sum.sizeBytes ?? 0;
    brainCount = b;
  }

  // What can this user actually buy from here?
  const canBuyPro = user.planTier !== "pro" && !grandfathered;
  const showManage = user.planTier === "pro";

  // Documents limit is per-brain × brain count (or a floor of 1 brain to
  // avoid showing "0 / 0" when a user has no brains yet).
  const documentsLimit = limits.documentsPerBrain * Math.max(1, brainCount);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          usage
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
            your usage
          </h1>
          <PlanBadge planTier={planTier} grandfathered={grandfathered} />
        </div>
        <p className="max-w-[560px] text-[13px] leading-6 text-[var(--color-muted)]">
          Point-in-time snapshot of everything stored in your active
          organization. Caps are set by whoever pays for that org, so a shared
          brain a teammate created counts against the same allowance.
          Rate-limited counters (searches, embedding tokens) aren&rsquo;t
          plotted here yet — they ship with the usage event pipeline.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {canBuyPro && (
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-lg bg-[var(--color-accent)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-black transition-colors hover:bg-[var(--color-accent)]/85"
            >
              upgrade to pro
            </Link>
          )}
          {showManage && <ManageBillingButton />}
          <Link
            href="/pricing"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] underline-offset-4 hover:text-[var(--color-ink)] hover:underline"
          >
            compare plans
          </Link>
        </div>
      </section>

      {grandfathered && placement !== null && placement !== undefined && (
        <section className="rounded-xl border border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)] p-5">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent)]">
              ✓ beta cohort
            </p>
            <p className="font-mono text-[13px] text-[var(--color-ink)]">
              aju #{placement} of 100 · free, permanently
            </p>
            <p className="text-[12px] leading-6 text-[var(--color-muted)]">
              You were here before there was a price, so these caps stay yours
              at no cost for as long as the account exists. Pro is there if you
              outgrow them, never because we withdrew this. Your data stays
              portable either way — run{" "}
              <span className="font-mono text-[var(--color-ink)]">
                aju export
              </span>{" "}
              or hit{" "}
              <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px]">
                GET /api/me/export
              </code>{" "}
              anytime.
            </p>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          snapshots
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <UsageTile
            label="brains"
            current={brainCount}
            limit={limits.brains}
            format={formatNumber}
            hint="Every brain in this organization, not only the ones you can open."
          />
          <UsageTile
            label="documents"
            current={documents}
            limit={documentsLimit}
            format={formatNumber}
            hint={`Total across brains · ${formatNumber(limits.documentsPerBrain)} per brain`}
          />
          <UsageTile
            label="files"
            current={files}
            limit={limits.storageBytesMax}
            format={(n) => (n === limits.storageBytesMax ? formatBytes(n) : formatNumber(n))}
            hint="Binary uploads (PDFs, images, etc.). Capped by storage, not count."
          />
          <UsageTile
            label="storage"
            current={storageBytes}
            limit={limits.storageBytesMax}
            format={formatBytes}
            hint="Sum of all file bytes in this organization, pooled."
          />
          <UsageTile
            label="api keys · active"
            current={apiKeysActive}
            limit={apiKeysLimit}
            format={formatNumber}
            hint="Non-revoked keys across every org. Rotate anything you suspect is leaked."
          />
          <div className="flex flex-col gap-4 rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/50 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              rate limits
            </p>
            <ul className="flex flex-col gap-2 font-mono text-[12px] text-[var(--color-muted)]">
              <li className="flex justify-between gap-3">
                <span>searches / month</span>
                <span className="text-[var(--color-ink)]">
                  {formatNumber(limits.searchesPerMonth)}
                </span>
              </li>
              <li className="flex justify-between gap-3">
                <span>embedding tokens / month</span>
                <span className="text-[var(--color-ink)]">
                  {formatNumber(limits.embeddingTokensPerMonth)}
                </span>
              </li>
            </ul>
            <p className="text-[11px] leading-5 text-[var(--color-muted)]">
              Live metering lands with the usage-event pipeline. Until then
              these are the ceilings your plan advertises.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-[var(--color-panel)]/50 p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          about these limits
        </p>
        <p className="mt-3 text-[13px] leading-6 text-[var(--color-muted)]">
          Storage, brains, and documents are capped by whoever pays for this
          organization: its Team subscription if it has one, otherwise the
          owner&rsquo;s personal plan. API keys are the exception — they belong
          to you rather than to any one org, so they use the best plan
          you&rsquo;re covered by anywhere. See{" "}
          <Link
            href="/pricing"
            className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
          >
            pricing
          </Link>{" "}
          for what each plan includes.
        </p>
      </section>
    </div>
  );
}
