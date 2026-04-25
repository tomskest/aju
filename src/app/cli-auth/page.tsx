import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { canManageMembers, type OrgRole } from "@/lib/tenant";
import ApproveControls from "@/components/cli-auth/ApproveControls";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ code?: string | string[] }>;

function normalizeCode(raw: string | string[] | undefined): string | null {
  if (!raw) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  return value.trim().toUpperCase();
}

export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const userCode = normalizeCode(params.code);
  const user = await currentUser();

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-[var(--color-ink)]">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-[520px] flex-col items-center gap-8 text-center">
          <Link
            href="/"
            className="text-[56px] font-light leading-none tracking-[-0.04em]"
          >
            aju
          </Link>

          <Body userCode={userCode} user={user} />
        </div>
      </main>

      <footer className="flex items-center justify-center gap-3 pb-8 font-mono text-[11px] text-[var(--color-faint)]">
        <span>aju.sh © {new Date().getFullYear()}</span>
        <span>·</span>
        <Link href="/legal/terms" className="hover:text-[var(--color-muted)]">
          terms
        </Link>
        <span>·</span>
        <Link href="/legal/privacy" className="hover:text-[var(--color-muted)]">
          privacy
        </Link>
      </footer>
    </div>
  );
}

async function Body({
  userCode,
  user,
}: {
  userCode: string | null;
  user: Awaited<ReturnType<typeof currentUser>>;
}) {
  if (!userCode) {
    return (
      <Panel
        eyebrow="missing code"
        headline="no device code in the url."
      >
        <p className="text-[13px] text-[var(--color-muted)]">
          start the flow from your terminal with{" "}
          <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-ink)]">
            aju login
          </code>
          , then open the link it prints.
        </p>
      </Panel>
    );
  }

  if (!user) {
    const returnTo = `/cli-auth?code=${encodeURIComponent(userCode)}`;
    return (
      <Panel
        eyebrow="sign in to continue"
        headline="authorize a device"
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-[var(--color-muted)]">
            a terminal is asking to connect on your behalf. sign in first, then
            we&apos;ll bring you back here to confirm.
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
            pending code
          </p>
          <div className="flex items-center justify-center rounded-md border border-white/10 bg-black/40 px-4 py-3 font-mono text-[18px] tracking-[0.28em] text-[var(--color-ink)]">
            {userCode}
          </div>
          <Link
            href={`/?return_to=${encodeURIComponent(returnTo)}`}
            className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-[var(--color-accent)]/20"
          >
            sign in
          </Link>
        </div>
      </Panel>
    );
  }

  const row = await prisma.deviceCode.findUnique({
    where: { userCode },
  });

  if (!row) {
    return (
      <Panel
        eyebrow="unknown code"
        headline="we don't recognize that code."
      >
        <p className="text-[13px] text-[var(--color-muted)]">
          double-check the code in your terminal, or run{" "}
          <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-ink)]">
            aju login
          </code>{" "}
          again to get a fresh one.
        </p>
      </Panel>
    );
  }

  if (row.expiresAt < new Date() || row.status === "used") {
    return (
      <Panel
        eyebrow="expired"
        headline="this code is no longer valid."
      >
        <p className="text-[13px] text-[var(--color-muted)]">
          codes are good for 10 minutes. run{" "}
          <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-ink)]">
            aju login
          </code>{" "}
          again for a new one.
        </p>
      </Panel>
    );
  }

  if (row.status === "approved") {
    return (
      <Panel
        eyebrow="already authorized"
        headline="this device is connected."
      >
        <p className="text-[13px] text-[var(--color-muted)]">
          you can close this tab — your terminal should have finished logging
          in.
        </p>
      </Panel>
    );
  }

  if (row.status === "denied") {
    return (
      <Panel
        eyebrow="denied"
        headline="this request was rejected."
      >
        <p className="text-[13px] text-[var(--color-muted)]">
          nothing else to do here. if you didn&apos;t mean to deny it, run{" "}
          <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-ink)]">
            aju login
          </code>{" "}
          again.
        </p>
      </Panel>
    );
  }

  // status === "pending" — branch on intent.
  if (row.intent === "agent") {
    return <AgentApprovePanel row={row} user={user} />;
  }

  return (
    <Panel
      eyebrow="connect a device"
      headline={`authorize as ${user.email}`}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-[var(--color-muted)]">
          a terminal wants to sign in as you. confirm the code below matches
          what you see in your terminal before authorizing.
        </p>

        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
            code from terminal
          </p>
          <div className="mt-2 flex items-center justify-center rounded-md border border-white/10 bg-black/40 px-4 py-3 font-mono text-[22px] tracking-[0.32em] text-[var(--color-ink)]">
            {row.userCode}
          </div>
        </div>

        <ApproveControls userCode={row.userCode} />

        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
          only authorize devices you started yourself.
        </p>
      </div>
    </Panel>
  );
}

/**
 * Agent-provisioning approve panel. Resolves the agent by name in the
 * approver's active org, surfaces its current brain grants, and blocks
 * approve when the approver lacks admin role or the agent is missing /
 * revoked. The server-side checks in /api/auth/device/approve are the
 * final gate — this is just UX.
 */
async function AgentApprovePanel({
  row,
  user,
}: {
  row: { userCode: string; agentName: string | null };
  user: NonNullable<Awaited<ReturnType<typeof currentUser>>>;
}) {
  const agentName = row.agentName?.trim() ?? "";
  if (!agentName) {
    return (
      <Panel
        eyebrow="malformed request"
        headline="missing agent name"
      >
        <p className="text-[13px] text-[var(--color-muted)]">
          the terminal didn&apos;t include an agent name. restart with{" "}
          <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-ink)]">
            aju agent-provision &lt;name&gt;
          </code>
          .
        </p>
      </Panel>
    );
  }

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) {
    return (
      <Panel
        eyebrow="no active org"
        headline="you aren't in an organization"
      >
        <p className="text-[13px] text-[var(--color-muted)]">
          agent keys are org-scoped. switch to the org that owns{" "}
          <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-ink)]">
            {agentName}
          </code>{" "}
          and reload this page.
        </p>
      </Panel>
    );
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { role: true },
  });
  const isAdmin =
    !!membership && canManageMembers(membership.role as OrgRole);

  const agentInfo = await withTenant(
    { organizationId, userId: user.id, unscoped: true },
    async ({ tx }) => {
      const agent = await tx.agent.findFirst({
        where: { name: agentName },
        select: { id: true, name: true, description: true, status: true },
      });
      if (!agent) return null;
      const grants = await tx.brainAccess.findMany({
        where: { agentId: agent.id },
        include: {
          brain: { select: { name: true, type: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return { agent, grants };
    },
  );

  if (!agentInfo) {
    return (
      <Panel
        eyebrow="agent not found"
        headline={`no agent named "${agentName}" in this org`}
      >
        <p className="text-[13px] text-[var(--color-muted)]">
          create it first with{" "}
          <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-ink)]">
            aju agents create {agentName}
          </code>
          , grant it brain access, then rerun the provision command on the
          remote.
        </p>
      </Panel>
    );
  }

  if (agentInfo.agent.status === "revoked") {
    return (
      <Panel
        eyebrow="agent revoked"
        headline={`"${agentName}" has been revoked`}
      >
        <p className="text-[13px] text-[var(--color-muted)]">
          no new keys can be minted for a revoked agent.
        </p>
      </Panel>
    );
  }

  if (!isAdmin) {
    return (
      <Panel
        eyebrow="insufficient permissions"
        headline="owner/admin required"
      >
        <p className="text-[13px] text-[var(--color-muted)]">
          minting agent keys requires owner or admin role in the org. ask an
          admin to run this approve step instead.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      eyebrow="provision an agent"
      headline={`mint a key for "${agentInfo.agent.name}"`}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-[var(--color-muted)]">
          a remote machine wants to act as this agent. it will be able to
          read and write only the brains listed below — nothing else.
        </p>

        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
            code from terminal
          </p>
          <div className="mt-2 flex items-center justify-center rounded-md border border-white/10 bg-black/40 px-4 py-3 font-mono text-[22px] tracking-[0.32em] text-[var(--color-ink)]">
            {row.userCode}
          </div>
        </div>

        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
            brain access
          </p>
          {agentInfo.grants.length === 0 ? (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 font-mono text-[12px] text-amber-200">
              no grants — this agent will authenticate but can&apos;t read or
              write anything until you run{" "}
              <code>aju agents grant</code>.
            </div>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {agentInfo.grants.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-[12px]"
                >
                  <span className="text-[var(--color-ink)]">
                    {g.brain.name}
                  </span>
                  <span className="text-[var(--color-faint)]">
                    {g.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ApproveControls userCode={row.userCode} />

        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
          only authorize machines you started yourself.
        </p>
      </div>
    </Panel>
  );
}

function Panel({
  eyebrow,
  headline,
  children,
}: {
  eyebrow: string;
  headline: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full rounded-xl border border-white/10 bg-[var(--color-panel)]/85 px-5 py-6 text-left shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-sm">
      <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-accent)]">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-[22px] font-light text-[var(--color-ink)]">
        {headline}
      </h1>
      <div className="mt-4">{children}</div>
    </div>
  );
}
