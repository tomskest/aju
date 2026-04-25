import Link from "next/link";
import type { ReactNode } from "react";

const LINKS = [
  { href: "#why", label: "why" },
  { href: "#model", label: "model" },
  { href: "#install", label: "install" },
  { href: "#mcp", label: "mcp" },
  { href: "#agents", label: "agents" },
  { href: "#cases", label: "in the wild" },
  { href: "/kb", label: "kb ↗" },
];

export default function HomeNav({ rightSlot }: { rightSlot?: ReactNode }) {
  return (
    <nav className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b border-white/5 bg-[rgba(5,6,8,0.85)] px-7 backdrop-blur-md">
      <div className="flex items-baseline gap-2.5">
        <Link
          href="/"
          className="text-[22px] font-light leading-none tracking-[-0.04em] text-[var(--color-ink)]"
        >
          aju
        </Link>
        <span className="inline-flex items-center gap-1.5 rounded border border-[var(--color-accent)]/35 bg-[var(--color-accent)]/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_rgba(34,197,94,0.7)] animate-[aju-pulse_1.8s_ease-in-out_infinite]" />
          open beta
        </span>
      </div>

      <div className="hidden items-center gap-1 md:flex">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-md border border-transparent px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/10 hover:text-[var(--color-ink)]"
          >
            {l.label}
          </Link>
        ))}
        {rightSlot}
      </div>

      {/* On mobile: keep the right-slot (login/console) visible, hide anchor links. */}
      <div className="md:hidden">{rightSlot}</div>
    </nav>
  );
}
