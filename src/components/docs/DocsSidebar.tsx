"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavItem = {
  label: string;
  href: string;
};

const NAV: NavItem[] = [
  { label: "Welcome", href: "/docs" },
  { label: "Getting started", href: "/docs/getting-started" },
  { label: "Concepts", href: "/docs/concepts" },
  { label: "CLI reference", href: "/docs/cli" },
  { label: "SDKs", href: "/docs/sdks" },
  { label: "Claude Code", href: "/docs/claude-code" },
  { label: "MCP (advanced)", href: "/docs/mcp" },
  { label: "Self-host", href: "/docs/self-host" },
  { label: "Beta plan", href: "/docs/beta-plan" },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/docs") return pathname === "/docs";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function DocsSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeItem = NAV.find((n) => isActive(pathname, n.href));

  return (
    <>
      {/* Mobile dropdown trigger */}
      <div className="md:hidden border-b border-white/5 bg-[var(--color-bg)]">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="flex w-full items-center justify-between px-6 py-4 font-mono text-[12px] text-[var(--color-ink)]"
          aria-expanded={mobileOpen}
          aria-controls="docs-mobile-nav"
        >
          <span className="flex items-center gap-2">
            <span className="text-[var(--color-faint)]">docs /</span>
            <span>{activeItem?.label ?? "Menu"}</span>
          </span>
          <span
            aria-hidden
            className={`text-[var(--color-muted)] transition-transform ${
              mobileOpen ? "rotate-180" : ""
            }`}
          >
            v
          </span>
        </button>
        {mobileOpen && (
          <nav
            id="docs-mobile-nav"
            className="flex flex-col gap-1 border-t border-white/5 px-4 pb-4 pt-2"
          >
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`rounded-md px-3 py-2 font-mono text-[12.5px] transition ${
                    active
                      ? "bg-[var(--color-panel)] text-[var(--color-ink)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:block md:w-[240px] md:shrink-0 md:border-r md:border-white/5">
        <div className="sticky top-[57px] max-h-[calc(100vh-57px)] overflow-y-auto px-6 py-10">
          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
            Documentation
          </p>
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group flex items-center gap-2 rounded-md px-3 py-2 text-[13px] transition ${
                    active
                      ? "bg-[var(--color-panel)] text-[var(--color-ink)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`size-[6px] rounded-full transition ${
                      active
                        ? "bg-[var(--color-accent)] shadow-[0_0_8px_rgba(34,197,94,0.7)]"
                        : "bg-transparent group-hover:bg-[var(--color-faint)]"
                    }`}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>
    </>
  );
}
