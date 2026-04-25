import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import Sidebar from "@/components/app/Sidebar";
import OrgSwitcher from "@/components/app/OrgSwitcher";

export const dynamic = "force-dynamic";

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
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-[56px] items-center justify-between border-b border-white/5 bg-[var(--color-bg)]/95 px-4 backdrop-blur md:px-6">
        <div className="flex items-center gap-4">
          <Link
            href="/app"
            className="flex items-center gap-3 text-[22px] font-light leading-none tracking-[-0.04em] text-[var(--color-ink)]"
          >
            aju
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-faint)] md:inline">
              console
            </span>
          </Link>
          <span
            className="hidden h-4 w-px bg-white/10 sm:inline-block"
            aria-hidden
          />
          <OrgSwitcher />
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden font-mono text-[11px] text-[var(--color-muted)] sm:inline">
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

      {/* Body: sidebar + content */}
      <div className="mx-auto flex max-w-[1200px] flex-col md:flex-row">
        <Sidebar />
        <main className="min-w-0 flex-1 px-5 py-8 md:px-10 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
