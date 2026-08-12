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
              signups are open
            </p>
            <h1 className="text-[20px] font-light">
              the waitlist is over — you can sign up now.
            </h1>
          </div>

          <div className="w-full rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5 text-center">
            <p className="text-[13px] text-[var(--color-ink)]">
              create your account on the free tier and upgrade whenever you
              need more room.
            </p>
            <p className="mt-3 font-mono text-[11px] text-[var(--color-muted)]">
              plans at{" "}
              <Link
                href="/pricing"
                className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                /pricing
              </Link>
            </p>
          </div>

          <Link
            href={email ? `/?email=${encodeURIComponent(email)}` : "/"}
            className="inline-flex items-center rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-[var(--color-accent)]/20"
          >
            sign up →
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
