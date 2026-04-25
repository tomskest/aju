import Link from "next/link";
import type { Metadata } from "next";
import DocsSidebar from "@/components/docs/DocsSidebar";

export const metadata: Metadata = {
  title: "Docs — aju",
  description:
    "Documentation for aju — memory infrastructure for AI agents. CLI-first, agent-first, open source.",
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[var(--color-bg)]/90 backdrop-blur">
        <div className="flex items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="inline-flex items-baseline gap-2 text-[18px] font-light tracking-[-0.03em] text-[var(--color-ink)] transition hover:text-[var(--color-ink)]"
          >
            <span>aju</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
              docs
            </span>
          </Link>
          <div className="hidden items-center gap-5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)] md:flex">
            <Link
              href="/"
              className="transition hover:text-[var(--color-ink)]"
            >
              home
            </Link>
            <Link
              href="/kb"
              className="transition hover:text-[var(--color-ink)]"
            >
              knowledge base
            </Link>
            <a
              href="https://github.com/tomskest/aju"
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-[var(--color-ink)]"
            >
              github
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-col md:flex-row">
        <DocsSidebar />

        <main className="min-w-0 flex-1 px-6 py-10 md:px-10 md:py-14">
          <div className="max-w-[640px]">{children}</div>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 px-6 py-6">
        <div className="flex items-center justify-center gap-4 font-mono text-[11px] text-[var(--color-faint)]">
          <span>aju.sh © {new Date().getFullYear()}</span>
          <span>·</span>
          <Link
            href="/legal/terms"
            className="transition hover:text-[var(--color-muted)]"
          >
            terms
          </Link>
          <span>·</span>
          <Link
            href="/legal/privacy"
            className="transition hover:text-[var(--color-muted)]"
          >
            privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}
