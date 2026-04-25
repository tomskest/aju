"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavItem = {
  label: string;
  href: string;
  external?: boolean;
};

const ITEMS: NavItem[] = [
  { label: "Overview", href: "/app/console" },
  { label: "Onboarding", href: "/app/onboarding" },
  { label: "Brains", href: "/app/brains" },
  { label: "API Keys", href: "/app/keys" },
  { label: "Usage", href: "/app/usage" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/app/console") return pathname === "/app/console";
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  return (
    <>
      {/* Mobile toggle */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar-nav"
        >
          <span className="select-none">{mobileOpen ? "close" : "menu"}</span>
        </button>
        <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          navigation
        </span>
      </div>

      <nav
        id="app-sidebar-nav"
        className={`${
          mobileOpen ? "block" : "hidden"
        } border-b border-white/5 px-3 py-3 md:sticky md:top-[56px] md:block md:h-[calc(100vh-56px)] md:w-[220px] md:shrink-0 md:self-start md:border-b-0 md:border-r md:px-3 md:py-6`}
      >
        <ul className="flex flex-col gap-0.5">
          {ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`block rounded-md px-3 py-2 text-[13px] transition ${
                    active
                      ? "bg-white/[0.04] text-[var(--color-ink)]"
                      : "text-[var(--color-muted)] hover:bg-white/[0.03] hover:text-[var(--color-ink)]"
                  }`}
                >
                  <span
                    className={`mr-2 select-none font-mono text-[11px] ${
                      active
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-faint)]"
                    }`}
                  >
                    {active ? "›" : "·"}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-8 border-t border-white/5 pt-4">
          <p className="px-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
            resources
          </p>
          <ul className="mt-2 flex flex-col gap-0.5">
            <li>
              <Link
                href="/kb"
                className="block rounded-md px-3 py-1.5 text-[12px] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
              >
                Knowledge base
              </Link>
            </li>
            <li>
              <Link
                href="/legal/terms"
                className="block rounded-md px-3 py-1.5 text-[12px] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
              >
                Terms
              </Link>
            </li>
            <li>
              <Link
                href="/legal/privacy"
                className="block rounded-md px-3 py-1.5 text-[12px] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
              >
                Privacy
              </Link>
            </li>
          </ul>
        </div>
      </nav>
    </>
  );
}
