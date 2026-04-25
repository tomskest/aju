import Sidebar from "@/components/app/Sidebar";

export const dynamic = "force-dynamic";

/**
 * Console area layout — admin and account settings (orgs, agents, keys,
 * usage, onboarding). Adds the Console sidebar nav next to children.
 *
 * Auth + top bar live in the parent /app layout, so this only handles
 * the side nav.
 */
export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col md:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 px-5 py-8 md:px-10 md:py-10">
        {children}
      </main>
    </div>
  );
}
