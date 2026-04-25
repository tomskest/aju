type Limit = {
  name: string;
  value: string;
};

const LIMITS: Limit[] = [
  { name: "Brains", value: "1" },
  { name: "Documents per brain", value: "100" },
  { name: "Searches per month", value: "1,000" },
  { name: "Embedding tokens per month", value: "100,000" },
  { name: "File storage", value: "1 GB" },
];

export default function BetaPlanPage() {
  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          Beta plan
        </p>
        <h1 className="text-[32px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          Beta runs through 30 June 2026.
        </h1>
        <p className="text-[14.5px] leading-relaxed text-[var(--color-muted)]">
          aju is in open beta. The first 100 verified users are placed on a
          plan called{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            beta_legacy
          </code>{" "}
          and get full access to the limits below, free, until 30 June 2026.
          After that date the service transitions — the exact shape (paid
          tier, reduced free tier, something else) will be decided before
          then. In every case, your data is portable.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          Beta limits
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
              You get the usage limits on this page, free, through 30 June
              2026.
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              We&rsquo;ll announce the post-beta transition before the window
              closes, and email Beta Cohort members at least 14 days in
              advance of any change.
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
              aju is Apache 2.0 — if you ever want to self-host, the code is
              yours.
            </span>
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/5 bg-[var(--color-panel)]/40 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
          What happens at 100
        </p>
        <p className="text-[14px] leading-relaxed text-[var(--color-ink)]">
          Once the 100th user is verified, public signups pause and a waitlist
          opens for the paid launch. New users will come off the waitlist
          onto a standard paid plan — still the same product, just not the
          grandfathered tier.
        </p>
      </section>
    </article>
  );
}
