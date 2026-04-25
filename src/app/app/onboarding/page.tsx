import BetaCountdown from "@/components/beta/BetaCountdown";
import OnboardingFlow from "@/components/app/OnboardingFlow";
import { betaEndHumanDate } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function getPlacement() {
  const user = await currentUser();
  if (!user || !user.grandfatheredAt) return null;
  const placement = await prisma.user.count({
    where: { grandfatheredAt: { not: null, lte: user.grandfatheredAt } },
  });
  return { user, placement };
}

export default async function OnboardingPage() {
  const ctx = await getPlacement();

  return (
    <div className="flex flex-col gap-10">
      {ctx && (
        <section className="flex flex-col gap-2 rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-accent)]">
            ✓ you&apos;re in
          </p>
          <h2 className="text-[22px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
            welcome, {ctx.user.name}.
          </h2>
          <p className="font-mono text-[12px] text-[var(--color-muted)]">
            you are aju #{ctx.placement} of 100 · beta runs through {betaEndHumanDate()}
          </p>
          <p className="mt-2 max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
            your personal brain is ready. choose how you want to drive aju —
            CLI, MCP, or both — and we&apos;ll walk you through the setup.
            your data stays yours: export anytime via{" "}
            <span className="font-mono text-[var(--color-ink)]">aju export</span>.
          </p>
        </section>
      )}

      <BetaCountdown />

      <section className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          onboarding
        </p>
        <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
          get aju running
        </h1>
        <p className="max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
          Pick a path — CLI if you want a local binary, MCP if you want to
          plug aju straight into Claude Desktop, Cursor, or another agent
          host, or both. No persisted progress; jump around freely.
        </p>
      </section>

      <OnboardingFlow />
    </div>
  );
}
