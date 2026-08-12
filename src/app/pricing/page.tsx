import Link from "next/link";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PLAN_LIMITS, isUnlimited } from "@/lib/billing";
import CheckoutButton from "@/components/landing/CheckoutButton";
import HomeNav from "@/components/landing/HomeNav";
import SiteFooter from "@/components/landing/SiteFooter";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — aju",
  description:
    "Memory infrastructure for AI agents. Free to start, Pro for individuals, Team for shared brains.",
};

function bytes(n: number): string {
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb % 1 === 0 ? gb : gb.toFixed(0)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

function count(n: number): string {
  return isUnlimited(n) ? "Unlimited" : n.toLocaleString("en-US");
}

type Plan = {
  key: "free" | "pro" | "team";
  name: string;
  price: string;
  cadence: string;
  pitch: string;
  features: string[];
  emphasis?: boolean;
};

const free = PLAN_LIMITS.free;
const pro = PLAN_LIMITS.pro;
const team = PLAN_LIMITS.team;

const PLANS: Plan[] = [
  {
    key: "free",
    name: "Free",
    price: "€0",
    cadence: "forever",
    pitch: "Enough to wire up an agent and see whether the memory sticks.",
    features: [
      `${count(free.brains)} brain`,
      `${count(free.documentsPerBrain)} documents`,
      `${bytes(free.storageBytesMax)} storage`,
      `${count(free.apiKeysMax)} API keys`,
      "CLI, MCP server, and REST API",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: "€20",
    cadence: "per month",
    pitch: "For one person with a real archive and more than one agent.",
    emphasis: true,
    features: [
      `${count(pro.brains)} brains`,
      `${count(pro.documentsPerBrain)} documents per brain`,
      `${bytes(pro.storageBytesMax)} storage`,
      `${count(pro.apiKeysMax)} API keys`,
      "Semantic search and graph retrieval",
      "Everything in Free",
    ],
  },
  {
    key: "team",
    name: "Team",
    price: "€30",
    cadence: "per seat / month",
    pitch: "Shared brains your whole team writes to, billed by the seat.",
    features: [
      "Unlimited brains",
      `${count(team.documentsPerBrain)} documents per brain`,
      `${bytes(team.storageBytesMax)} pooled storage`,
      "Org-wide access control and audit log",
      "Agent principals with scoped grants",
      "Everything in Pro",
    ],
  },
];

export default async function PricingPage() {
  const user = await currentUser();
  const signedIn = Boolean(user);

  // Which org would a Team purchase bill to? With exactly one non-personal
  // org the user can pay for, the button bills it directly; with several,
  // the button grows a chooser so the user names the invoice target instead
  // of us guessing; with none, we send them to create an org first.
  let teamOrgId: string | undefined;
  let teamOrgs: { id: string; name: string }[] | undefined;
  if (user) {
    const owned = await prisma.organizationMembership.findMany({
      where: {
        userId: user.id,
        acceptedAt: { not: null },
        role: { in: ["owner", "admin"] },
        organization: { isPersonal: false, planTier: { not: "team" } },
      },
      select: {
        organizationId: true,
        organization: { select: { name: true } },
      },
      orderBy: { organization: { name: "asc" } },
      take: 20,
    });
    if (owned.length === 1) {
      teamOrgId = owned[0].organizationId;
    } else if (owned.length > 1) {
      teamOrgs = owned.map((m) => ({
        id: m.organizationId,
        name: m.organization.name,
      }));
    }
  }

  const currentTier = user?.planTier ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <HomeNav
        rightSlot={
          <Link
            href={signedIn ? "/app/usage" : "/"}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            {signedIn ? "console" : "sign in"}
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col gap-12 px-7 py-16">
        <header className="flex flex-col gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            pricing
          </p>
          <h1 className="text-[34px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
            Memory that outlives the context window.
          </h1>
          <p className="max-w-[620px] text-[14px] leading-7 text-[var(--color-muted)]">
            Start free, upgrade when your archive does. Every plan speaks the
            same CLI, MCP server, and REST API, and every plan can{" "}
            <span className="font-mono text-[var(--color-ink)]">aju export</span>{" "}
            everything you have stored, whenever you like.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent = currentTier === plan.key;
            return (
              <div
                key={plan.key}
                className={`flex flex-col gap-6 rounded-xl border p-6 ${
                  plan.emphasis
                    ? "border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)]"
                    : "border-white/10 bg-[var(--color-panel)]/85"
                }`}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
                      {plan.name}
                    </p>
                    {isCurrent && (
                      <span className="rounded-full border border-white/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                        current
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[32px] font-light tracking-[-0.02em] text-[var(--color-ink)]">
                      {plan.price}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--color-faint)]">
                      {plan.cadence}
                    </span>
                  </div>
                  <p className="text-[12px] leading-6 text-[var(--color-muted)]">
                    {plan.pitch}
                  </p>
                </div>

                <ul className="flex flex-1 flex-col gap-2.5">
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      className="flex gap-2.5 text-[12px] leading-6 text-[var(--color-muted)]"
                    >
                      <span
                        aria-hidden
                        className="text-[var(--color-accent)]"
                      >
                        ·
                      </span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {plan.key === "free" ? (
                  <Link
                    href={signedIn ? "/app/usage" : "/?signup=1"}
                    className="inline-flex w-full items-center justify-center rounded-lg border border-white/15 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-ink)] transition-colors hover:border-white/30 hover:bg-white/[0.04]"
                  >
                    {signedIn ? "go to console" : "start free"}
                  </Link>
                ) : plan.key === "team" &&
                  signedIn &&
                  !teamOrgId &&
                  !teamOrgs ? (
                  // No org a Team purchase could bill to yet, so send them
                  // to create one rather than inventing an invoice target.
                  <Link
                    href="/app/orgs"
                    className="inline-flex w-full items-center justify-center rounded-lg border border-white/15 px-5 py-3 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-ink)] transition-colors hover:border-white/30 hover:bg-white/[0.04]"
                  >
                    choose an org
                  </Link>
                ) : (
                  <CheckoutButton
                    tier={plan.key === "pro" ? "pro" : "team"}
                    interval="monthly"
                    organizationId={plan.key === "team" ? teamOrgId : undefined}
                    orgs={plan.key === "team" ? teamOrgs : undefined}
                    signedIn={signedIn}
                    emphasis={plan.emphasis}
                    label={isCurrent ? "manage plan" : `get ${plan.name}`}
                  />
                )}
              </div>
            );
          })}
        </section>

        <section className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[var(--color-panel)]/50 p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
            the fine print
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <p className="font-mono text-[12px] text-[var(--color-ink)]">
                Pro and Team stack
              </p>
              <p className="text-[12px] leading-6 text-[var(--color-muted)]">
                Pro covers the brains you own. Team covers the org that pays
                for it. Joining a Team doesn&rsquo;t change the caps on your
                personal brains, and cancelling one never touches the other.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="font-mono text-[12px] text-[var(--color-ink)]">
                Seats follow membership
              </p>
              <p className="text-[12px] leading-6 text-[var(--color-muted)]">
                Team is billed on accepted members. Add someone mid-month and
                you&rsquo;re charged pro rata; remove them and it comes back off.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="font-mono text-[12px] text-[var(--color-ink)]">
                Your data leaves with you
              </p>
              <p className="text-[12px] leading-6 text-[var(--color-muted)]">
                <span className="font-mono text-[var(--color-ink)]">
                  aju export
                </span>{" "}
                works on every plan, including after you cancel. Prices exclude
                VAT, which is added at checkout where it applies.
              </p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
