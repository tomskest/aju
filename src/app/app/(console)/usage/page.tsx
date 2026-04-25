import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma, tenantDbFor } from "@/lib/db";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import { limitsFor } from "@/lib/billing";

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
  const safeLimit = limit > 0 ? limit : 1;
  const ratio = Math.min(1, current / safeLimit);
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const threshold = thresholdFor(ratio);

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
          / {format(limit)}
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
  const label = isBetaLegacy
    ? "Beta Legacy"
    : planTier === "free"
      ? "Free"
      : planTier;

  const tone = isBetaLegacy
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
  const planTier = user.planTier ?? "free";
  const grandfathered = user.grandfatheredAt !== null;
  const limits = limitsFor(planTier);

  const organizationId = await getActiveOrganizationId();

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

  // Tenant-plane counters — scoped to the active org's DB, limited to brains
  // the caller has access to. A user with no active org shows zero for
  // tenant-backed tiles (plan limits still render).
  let documents = 0;
  let files = 0;
  let storageBytes = 0;
  let brainCount = 0;
  if (organizationId) {
    const tenant = await tenantDbFor(organizationId);
    const [d, f, fAgg, b] = await Promise.all([
      tenant.vaultDocument.count({
        where: { brain: { access: { some: { userId } } } },
      }),
      tenant.vaultFile.count({
        where: { brain: { access: { some: { userId } } } },
      }),
      tenant.vaultFile.aggregate({
        where: { brain: { access: { some: { userId } } } },
        _sum: { sizeBytes: true },
      }),
      tenant.brainAccess.count({ where: { userId } }),
    ]);
    documents = d;
    files = f;
    storageBytes = fAgg._sum.sizeBytes ?? 0;
    brainCount = b;
  }

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
          Point-in-time snapshot of what you&rsquo;re storing across every
          brain you can access in your active organization. Rate-limited
          counters (searches, embedding tokens) aren&rsquo;t plotted here yet —
          they ship with the usage event pipeline.
        </p>
      </section>

      {grandfathered && placement !== null && placement !== undefined && (
        <section className="rounded-xl border border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)] p-5">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent)]">
              ✓ beta cohort
            </p>
            <p className="font-mono text-[13px] text-[var(--color-ink)]">
              aju #{placement} of 100 · beta runs through 30 June 2026
            </p>
            <p className="text-[12px] leading-6 text-[var(--color-muted)]">
              Transition plan will be finalised before the beta closes. No
              matter how it shakes out, your data stays portable — run{" "}
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
            hint="Vaults you own or have been granted access to."
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
            hint="Sum of all file bytes across your brains."
          />
          <UsageTile
            label="api keys · active"
            current={apiKeysActive}
            limit={limits.apiKeysMax}
            format={formatNumber}
            hint="Non-revoked keys. Rotate anything you suspect is leaked."
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
          The beta legacy plan locks in a generous set of caps for the first
          100 verified signups. Read the{" "}
          <Link
            href="/doc/beta-plan"
            className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
          >
            beta plan details
          </Link>{" "}
          for what&rsquo;s included, what stays free, and how the cohort
          counter works.
        </p>
      </section>
    </div>
  );
}
