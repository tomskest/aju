import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import OrgSwitcher from "@/components/app/OrgSwitcher";
import TopBarTabs from "@/components/app/TopBarTabs";

export const dynamic = "force-dynamic";

/**
 * Top-level /app shell. Renders the header (logo + org switcher + console
 * link + sign out) and delegates the body to nested layouts:
 *
 *   - /app                → redirects (page.tsx)
 *   - /app/brain/...      → (brain) group: brain-rail layout
 *   - /app/console + /app/orgs/... etc → (console) group: console-nav layout
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      <header className="sticky top-0 z-20 flex h-[56px] items-center justify-between border-b border-white/5 bg-[var(--color-bg)]/95 px-4 backdrop-blur md:px-6">
        <div className="flex items-center gap-4">
          <Link
            href="/app"
            className="flex items-center gap-3 text-[22px] font-light leading-none tracking-[-0.04em] text-[var(--color-ink)]"
          >
            aju
          </Link>
          <span
            className="hidden h-4 w-px bg-white/10 sm:inline-block"
            aria-hidden
          />
          <OrgSwitcher />
        </div>

        <div className="flex items-center gap-5">
          <TopBarTabs />
          <span className="hidden font-mono text-[11px] text-[var(--color-faint)] md:inline">
            {user.email}
          </span>
          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              className="inline-flex items-center rounded-md border border-white/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
            >
              sign out
            </button>
          </form>
        </div>
      </header>

      {children}
    </div>
  );
}
