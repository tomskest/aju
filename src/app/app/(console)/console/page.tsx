import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import {
  effectiveTierForOrg,
  isUnlimited,
  limitsFor,
  nextTierFor,
  tierLabel,
  type PlanTier,
} from "@/lib/billing";
import PlanBadge from "@/components/app/PlanBadge";

export const dynamic = "force-dynamic";

/** "20 brains, 20,000 documents per brain, 25 GB storage" */
function capLine(tier: PlanTier | string): string {
  const limits = limitsFor(tier);
  const brains = isUnlimited(limits.brains)
    ? "unlimited brains"
    : `${limits.brains.toLocaleString("en-US")} brains`;
  const docs = `${limits.documentsPerBrain.toLocaleString("en-US")} documents per brain`;
  const storage =
    limits.storageBytesMax >= 1024 ** 3
      ? `${Math.round(limits.storageBytesMax / 1024 ** 3)} GB storage`
      : `${Math.round(limits.storageBytesMax / 1024 ** 2)} MB storage`;
  return `${brains}, ${docs}, ${storage}`;
}

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

  // Plan strip. Resolved against the ACTIVE ORG, matching what enforcement
  // does: showing the user's personal tier would misreport the ceiling for
  // anyone working inside a Team org. Skipped for the beta cohort, who have
  // nothing to buy and shouldn't be sold to.
  const organizationId = await getActiveOrganizationId();
  const org = organizationId
    ? await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { isPersonal: true },
      })
    : null;
  const orgTier: PlanTier = organizationId
    ? await effectiveTierForOrg(organizationId)
    : "free";
  const upgradeTo =
    placement === null
      ? nextTierFor(orgTier, org ? !org.isPersonal : false)
      : null;

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

      {placement === null && (
        <section className="rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <PlanBadge planTier={orgTier} />
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
                  active org
                </span>
              </div>
              <p className="text-[12px] leading-5 text-[var(--color-muted)]">
                {capLine(orgTier)}.
              </p>
              {upgradeTo && (
                <p className="text-[12px] leading-5 text-[var(--color-muted)]">
                  {tierLabel(upgradeTo)} raises that to {capLine(upgradeTo)}.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 self-start">
              {upgradeTo && (
                <Link
                  href="/pricing"
                  className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-black transition-colors hover:bg-[var(--color-accent)]/85"
                >
                  upgrade to {upgradeTo}
                </Link>
              )}
              <Link
                href="/app/billing"
                className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
              >
                billing →
              </Link>
            </div>
          </div>
        </section>
      )}

      {placement !== null && (
        <section className="rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent)]">
                ✓ beta legacy plan
              </p>
              <p className="font-mono text-[13px] text-[var(--color-ink)]">
                you are aju #{placement} of 100 · your plan stays free
              </p>
              <p className="text-[12px] text-[var(--color-muted)]">
                the beta cohort keeps its plan at no cost. your data is yours
                either way — export anytime via{" "}
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
