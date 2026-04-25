"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type BrainRailItem = {
  name: string;
  type: string;
  role: string;
  docCount: number;
};

/**
 * Vertical brains rail — leftmost column of the brain explorer. Lists
 * every brain the user can access in the active org. Active state is
 * derived from the URL (`/app/brain/<name>/...`) rather than props so
 * cross-brain navigation feels instant.
 *
 * Personal brains float above org brains; within a section, alphabetical.
 */
export default function BrainsRail({
  items,
  canCreate,
}: {
  items: BrainRailItem[];
  canCreate: boolean;
}) {
  const pathname = usePathname();
  const activeName = decodeName(pathname);

  const personal = items.filter((b) => b.type === "personal");
  const org = items.filter((b) => b.type === "org");

  return (
    <aside className="hidden w-[200px] shrink-0 flex-col border-r border-white/5 bg-[var(--color-bg)] md:flex">
      <div className="border-b border-white/5 px-5 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          brains
        </p>
        <p className="mt-1 font-mono text-[10px] text-[var(--color-faint)]/70">
          {items.length} accessible
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {personal.length > 0 && (
          <Section label="personal" items={personal} activeName={activeName} />
        )}
        {org.length > 0 && (
          <Section
            label="org"
            items={org}
            activeName={activeName}
            withTopGap={personal.length > 0}
          />
        )}
        {items.length === 0 && (
          <p className="px-3 font-mono text-[11px] text-[var(--color-faint)]">
            no brains yet
          </p>
        )}
      </nav>

      {canCreate && (
        <div className="border-t border-white/5 px-3 py-3">
          <Link
            href="/app/brains"
            className="block rounded-md border border-white/10 px-3 py-1.5 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
          >
            + new brain
          </Link>
        </div>
      )}
    </aside>
  );
}

function Section({
  label,
  items,
  activeName,
  withTopGap = false,
}: {
  label: string;
  items: BrainRailItem[];
  activeName: string | null;
  withTopGap?: boolean;
}) {
  return (
    <div className={withTopGap ? "mt-5" : ""}>
      <p className="px-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
        {label}
      </p>
      <ul className="mt-2 flex flex-col gap-0.5">
        {items.map((b) => {
          const active = activeName === b.name;
          return (
            <li key={b.name}>
              <Link
                href={`/app/brain/${encodeURIComponent(b.name)}`}
                className={`group flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition ${
                  active
                    ? "bg-[var(--color-panel)] text-[var(--color-ink)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                }`}
                title={`${b.name} — ${b.role}`}
              >
                <span
                  aria-hidden
                  className={`size-[6px] shrink-0 rounded-full transition ${
                    active
                      ? "bg-[var(--color-accent)] shadow-[0_0_8px_rgba(34,197,94,0.7)]"
                      : "bg-transparent group-hover:bg-[var(--color-faint)]"
                  }`}
                />
                <span className="truncate">{b.name}</span>
                <span className="ml-auto font-mono text-[10px] text-[var(--color-faint)]/70">
                  {b.docCount}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function decodeName(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/app\/brain\/([^/]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
