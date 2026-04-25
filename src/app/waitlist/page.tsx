import Link from "next/link";

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-[var(--color-ink)]">
      <main className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="flex w-full max-w-[520px] flex-col items-center gap-6 text-center">
          <Link
            href="/"
            className="text-[56px] font-light leading-none tracking-[-0.04em]"
          >
            aju
          </Link>

          <div className="flex flex-col items-center gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-muted)]">
              beta full
            </p>
            <h1 className="text-[20px] font-light">
              the grandfather cohort is closed.
            </h1>
          </div>

          <div className="w-full rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5 text-center">
            <p className="text-[13px] text-[var(--color-ink)]">
              {email ? (
                <>
                  we&apos;ve added{" "}
                  <code className="font-mono text-[12px] text-[var(--color-accent)]">
                    {email}
                  </code>{" "}
                  to the waitlist.
                </>
              ) : (
                <>we&apos;ll email you when paid signups open.</>
              )}
            </p>
            <p className="mt-3 font-mono text-[11px] text-[var(--color-muted)]">
              expected: once stripe + paid tiers ship.
            </p>
          </div>

          <Link
            href="/"
            className="font-mono text-[11px] text-[var(--color-muted)] underline-offset-4 hover:underline hover:text-[var(--color-ink)]"
          >
            ← back
          </Link>
        </div>
      </main>

      <footer className="flex items-center justify-center gap-3 pb-8 text-[11px] font-mono text-[var(--color-faint)]">
        <span>aju.sh © {new Date().getFullYear()}</span>
        <span>·</span>
        <Link href="/legal/terms" className="hover:text-[var(--color-muted)]">
          terms
        </Link>
        <span>·</span>
        <Link href="/legal/privacy" className="hover:text-[var(--color-muted)]">
          privacy
        </Link>
      </footer>
    </div>
  );
}
