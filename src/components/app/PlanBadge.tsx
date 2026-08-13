import { isHighlightedTier, tierLabel } from "@/lib/billing/tiers";

/**
 * Tier pill, shared by the usage page, the billing page, and the console
 * overview strip.
 *
 * Imports from `@/lib/billing/tiers` rather than the billing barrel: the
 * barrel re-exports the Prisma clients and the Stripe SDK, and a presentation
 * component has no business pulling either.
 */
export default function PlanBadge({
  planTier,
  grandfathered = false,
}: {
  planTier: string;
  grandfathered?: boolean;
}) {
  // Paid and grandfathered tiers both get the accent treatment: one is earned,
  // the other is bought, and neither should read as the default state.
  const tone = isHighlightedTier(planTier)
    ? "border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
    : "border-white/10 bg-white/[0.04] text-[var(--color-muted)]";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.24em] uppercase ${tone}`}
    >
      {grandfathered && <span aria-hidden>✓</span>}
      {tierLabel(planTier)}
    </span>
  );
}
