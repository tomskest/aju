import { betaEndHumanDate, daysUntilBetaEnds, isBetaActive } from "@/lib/billing";

/**
 * Beta-window countdown card. Server component — no live ticking.
 * Rerenders on each page request, which is precise enough for a day-level
 * countdown.
 */
export default function BetaCountdown({
  variant = "default",
}: {
  variant?: "default" | "compact";
}) {
  const active = isBetaActive();
  const days = daysUntilBetaEnds();
  const endLabel = betaEndHumanDate();

  if (variant === "compact") {
    return (
      <p className="font-mono text-[11px] text-[var(--color-muted)]">
        <span
          className={
            active
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-faint)]"
          }
        >
          {active ? "beta" : "beta closed"}
        </span>
        <span className="px-2 text-[var(--color-faint)]">·</span>
        {active ? (
          <>ends {endLabel} · {days} days left</>
        ) : (
          <>ended {endLabel}</>
        )}
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
        beta window
      </p>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-[28px] leading-none text-[var(--color-ink)]">
          {days}
        </span>
        <span className="font-mono text-[13px] text-[var(--color-muted)]">
          days until beta closes
        </span>
      </div>
      <p className="text-[12px] leading-6 text-[var(--color-muted)]">
        Beta runs through{" "}
        <span className="font-mono text-[var(--color-ink)]">{endLabel}</span>.
        Transition plan will be finalised before then. In any case, your data
        is yours — export it anytime via{" "}
        <span className="font-mono text-[var(--color-ink)]">aju export</span>{" "}
        or{" "}
        <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px]">
          GET /api/me/export
        </code>
        .
      </p>
    </section>
  );
}
