import Link from "next/link";

export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative z-10 flex items-center justify-center gap-4 pb-8 pt-10 text-[11px] font-mono text-[var(--color-faint)]">
      <span>aju.sh © {year}</span>
      <span className="text-[var(--color-faint)]">·</span>
      <Link
        href="/kb"
        className="transition hover:text-[var(--color-muted)]"
      >
        knowledge base
      </Link>
      <span className="text-[var(--color-faint)]">·</span>
      <Link
        href="/legal/terms"
        className="transition hover:text-[var(--color-muted)]"
      >
        terms
      </Link>
      <span className="text-[var(--color-faint)]">·</span>
      <Link
        href="/legal/privacy"
        className="transition hover:text-[var(--color-muted)]"
      >
        privacy
      </Link>
    </footer>
  );
}
