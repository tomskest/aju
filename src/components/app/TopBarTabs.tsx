"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const CONSOLE_PREFIXES = [
  "/app/console",
  "/app/orgs",
  "/app/brains",
  "/app/keys",
  "/app/agents",
  "/app/usage",
  "/app/onboarding",
  "/app/join",
];

/**
 * Top bar tabs — switch between the brain explorer (primary surface) and
 * the Console (admin/settings). Active state is derived from the URL
 * prefix; `/app` and `/app/brain/*` count as brains, everything else
 * under `/app/...` counts as console.
 */
export default function TopBarTabs() {
  const pathname = usePathname() ?? "";
  const onConsole = CONSOLE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const onBrains = !onConsole;

  return (
    <nav className="hidden items-center gap-5 sm:flex">
      <Link
        href="/app"
        className={`font-mono text-[11px] uppercase tracking-[0.2em] transition ${
          onBrains
            ? "text-[var(--color-ink)]"
            : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        }`}
      >
        brains
      </Link>
      <Link
        href="/app/console"
        className={`font-mono text-[11px] uppercase tracking-[0.2em] transition ${
          onConsole
            ? "text-[var(--color-ink)]"
            : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        }`}
      >
        console
      </Link>
    </nav>
  );
}
