import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { betaEndHumanDate } from "@/lib/billing";
import BetaCountdown from "@/components/beta/BetaCountdown";

export const dynamic = "force-dynamic";

type Tile = {
  title: string;
  description: string;
  href: string;
  cta: string;
};

const TILES: Tile[] = [
  {
    title: "Manage brains",
    description:
      "Create, rename, and review every brain in your active org. Each brain is isolated and searchable.",
    href: "/app/brains",
    cta: "open brains →",
  },
  {
    title: "Install the CLI",
    description:
      "One-line install gets you `aju login`, `aju recall`, and the full MCP surface on your machine.",
    href: "/doc/getting-started",
    cta: "read the guide →",
  },
  {
    title: "Connect an MCP client",
    description:
      "Point Claude Desktop, Claude.ai, Cursor, OpenCode, or any MCP host at the aju remote endpoint with a bearer token.",
    href: "/doc/mcp",
    cta: "wire it up →",
  },
  {
    title: "Connect Claude Code",
    description:
      "Drop the aju skill into your Claude Code setup to let agents write and read memory automatically.",
    href: "/doc/claude-code",
    cta: "set it up →",
  },
  {
    title: "Walk through onboarding",
    description:
      "Six short steps covering install, login, brains, documents, MCP clients, and the Claude Code skill.",
    href: "/app/onboarding",
    cta: "start onboarding →",
  },
];

export default async function ConsoleHome() {
  const user = await currentUser();
  if (!user) redirect("/");

  let placement: number | null = null;
  if (user.grandfatheredAt) {
    placement = await prisma.user.count({
      where: {
        grandfatheredAt: { not: null, lte: user.grandfatheredAt },
      },
    });
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          console
        </p>
        <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
          welcome, {user.name}
        </h1>
      </section>

      <BetaCountdown />

      {placement !== null && (
        <section className="rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent)]">
                ✓ beta legacy plan
              </p>
              <p className="font-mono text-[13px] text-[var(--color-ink)]">
                you are aju #{placement} of 100 · beta runs through {betaEndHumanDate()}
              </p>
              <p className="text-[12px] text-[var(--color-muted)]">
                transition plan finalised before the beta closes. your data is
                yours either way — export anytime via{" "}
                <span className="font-mono text-[var(--color-ink)]">
                  aju export
                </span>
                .
              </p>
            </div>
            <Link
              href="/app/onboarding"
              className="self-start rounded-md border border-white/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
            >
              onboarding →
            </Link>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          quick actions
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {TILES.map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="group flex flex-col gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5 transition hover:border-white/20 hover:bg-[var(--color-panel)]"
            >
              <h2 className="text-[15px] font-medium text-[var(--color-ink)]">
                {tile.title}
              </h2>
              <p className="text-[13px] leading-6 text-[var(--color-muted)]">
                {tile.description}
              </p>
              <span className="mt-auto font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition group-hover:text-[var(--color-ink)]">
                {tile.cta}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
