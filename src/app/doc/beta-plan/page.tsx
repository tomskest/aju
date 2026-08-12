import Link from "next/link";

type Limit = {
  name: string;
  value: string;
};

// Mirrors PLAN_LIMITS.beta_legacy in src/lib/billing/plan-limits.ts.
const LIMITS: Limit[] = [
  { name: "Brains", value: "5" },
  { name: "Documents per brain", value: "1,000" },
  { name: "API keys", value: "10" },
  { name: "Searches per month", value: "10,000" },
  { name: "Embedding tokens per month", value: "1,000,000" },
  { name: "File storage", value: "1 GB" },
];

export default function BetaPlanPage() {
  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          Beta legacy plan
        </p>
        <h1 className="text-[32px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          The beta ended. The cohort keeps its plan, free.
        </h1>
        <p className="text-[14.5px] leading-relaxed text-[var(--color-muted)]">
          aju&rsquo;s closed beta ran through 30 June 2026. The first 100
          verified users were placed on a plan called{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            beta_legacy
          </code>{" "}
          and stay on it at no cost, indefinitely. They were here first and
          never agreed to a price. Everyone else signs up on the free tier
          and can upgrade &mdash; current plans live at{" "}
          <Link
            href="/pricing"
            className="text-[var(--color-accent)] underline-offset-4 hover:underline"
          >
            /pricing
          </Link>
          .
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          Beta legacy limits
        </h2>
        <div className="rounded-xl border border-white/5 bg-[var(--color-panel)]/50">
          <ul className="divide-y divide-white/5">
            {LIMITS.map((l) => (
              <li
                key={l.name}
                className="flex items-center justify-between px-4 py-3 text-[14px]"
              >
                <span className="text-[var(--color-muted)]">{l.name}</span>
                <span className="font-mono text-[13px] text-[var(--color-ink)]">
                  {l.value}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--color-muted)]">
          Need more room? Any beta account can upgrade to a paid plan at any
          time &mdash; the grandfathered tier never expires, so there&rsquo;s
          no pressure to.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          What being in the Beta Cohort means
        </h2>
        <ul className="flex flex-col gap-3 text-[14px] leading-relaxed text-[var(--color-muted)]">
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              You keep the usage limits on this page, free, with no end date.
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              If the arrangement ever changes, Beta Cohort members get email
              notice at least 14 days in advance.
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              Your data is yours, no matter the outcome. Run{" "}
              <code className="font-mono text-[13px] text-[var(--color-ink)]">
                aju export
              </code>{" "}
              or{" "}
              <code className="font-mono text-[13px] text-[var(--color-ink)]">
                GET /api/me/export
              </code>{" "}
              at any time to pull a portable copy of everything you&rsquo;ve
              stored.
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              aju is Apache 2.0 &mdash; if you ever want to self-host, the
              code is yours.
            </span>
          </li>
        </ul>
      </section>
    </article>
  );
}
