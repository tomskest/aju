/**
 * Tier vocabulary with no server dependencies.
 *
 * Separate from `plan-limits` so a React component can import the labels
 * without dragging Prisma and the Stripe SDK along with them: the billing
 * barrel re-exports the client and the tenant DB, neither of which belongs
 * anywhere near a component that might one day render on the client.
 */

export const TIER_LABELS = {
  free: "Free",
  beta_legacy: "Beta Legacy",
  pro: "Pro",
  team: "Team",
  beta_founder: "Founder",
} as const;

export type TierName = keyof typeof TIER_LABELS;

export function tierLabel(tier: string | null | undefined): string {
  if (tier && tier in TIER_LABELS) return TIER_LABELS[tier as TierName];
  return tier ?? "Free";
}

/** Tiers that read as earned or bought rather than as the default state. */
export function isHighlightedTier(tier: string | null | undefined): boolean {
  return tier === "pro" || tier === "team" || tier === "beta_legacy";
}
