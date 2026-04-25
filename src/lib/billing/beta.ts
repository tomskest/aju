/**
 * Beta cohort timeline.
 *
 * The closed-beta window runs from the project's soft-launch until the
 * date below. During this window, grandfathered users have full `beta_legacy`
 * plan access at no cost. What happens after is deliberately open —
 * transition plans will be finalised before the window closes. In all
 * cases, user data remains portable via `aju export` / `/api/me/export`.
 */

export const BETA_END = new Date("2026-06-30T23:59:59Z");

export function isBetaActive(now: Date = new Date()): boolean {
  return now < BETA_END;
}

export function daysUntilBetaEnds(now: Date = new Date()): number {
  const ms = BETA_END.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function betaEndHumanDate(): string {
  return BETA_END.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
