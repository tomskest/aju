import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { PrismaClient as PrismaClientTenant } from "@prisma/client-tenant";
import { prisma, tenantDbFor } from "@/lib/db";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import {
  canManageMembers,
  canManageOrg,
  type OrgRole,
} from "@/lib/tenant";
import AgentKeysPanel from "./AgentKeysPanel";

export const dynamic = "force-dynamic";

/**
 * Agent detail — manage grants, pause/resume, revoke, and inspect activity.
 */

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

type AgentRecord = {
  id: string;
  name: string;
  description: string | null;
  createdByUserId: string;
  status: string;
  createdAt: Date;
};

async function loadAgent(
  tenant: PrismaClientTenant,
  agentId: string,
): Promise<AgentRecord | null> {
  return tenant.agent.findFirst({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      description: true,
      createdByUserId: true,
      status: true,
      createdAt: true,
    },
  });
}

async function loadBrainGrants(
  tenant: PrismaClientTenant,
  agentId: string,
) {
  const grants = await tenant.brainAccess.findMany({
    where: { agentId },
    orderBy: { createdAt: "asc" },
    include: {
      brain: { select: { id: true, name: true, type: true } },
    },
  });
  return grants.map((g) => ({
    accessId: g.id,
    brainId: g.brain.id,
    brainName: g.brain.name,
    brainType: g.brain.type,
    role: g.role,
    grantedAt: g.createdAt,
  }));
}

async function loadActivity(
  tenant: PrismaClientTenant,
  agentId: string,
  limit: number,
) {
  try {
    const rows = await tenant.vaultChangeLog.findMany({
      where: { actorType: "agent", actorId: agentId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        brainId: true,
        documentId: true,
        path: true,
        operation: true,
        source: true,
        createdAt: true,
      },
    });
    return rows;
  } catch (err) {
    console.warn("[agents] activity query failed:", err);
    return [];
  }
}

async function assertAgentAccess(agentId: string): Promise<{
  user: { id: string; name: string; email: string };
  organizationId: string;
  role: OrgRole;
  tenant: PrismaClientTenant;
  agent: AgentRecord;
}> {
  const user = await currentUser();
  if (!user) redirect("/");
  const organizationId = await getActiveOrganizationId();
  if (!organizationId) redirect("/app/agents?error=no-active-org");

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId: organizationId! },
    select: { role: true },
  });
  if (!membership) notFound();

  const tenant = await tenantDbFor(organizationId!);
  const agent = await loadAgent(tenant, agentId);
  if (!agent) notFound();

  return {
    user: { id: user.id, name: user.name, email: user.email },
    organizationId: organizationId!,
    role: membership.role as OrgRole,
    tenant,
    agent: agent!,
  };
}

async function pauseAction(formData: FormData): Promise<void> {
  "use server";
  const agentId = (formData.get("agentId") as string | null) ?? "";
  if (!agentId) return;
  const { role, tenant, agent } = await assertAgentAccess(agentId);
  if (!canManageMembers(role)) {
    redirect(`/app/agents/${agentId}?error=forbidden`);
  }
  if (agent.status !== "revoked") {
    await tenant.agent.update({
      where: { id: agentId },
      data: { status: "paused" },
    });
  }
  revalidatePath(`/app/agents/${agentId}`);
  revalidatePath(`/app/agents`);
  redirect(`/app/agents/${agentId}?ok=paused`);
}

async function resumeAction(formData: FormData): Promise<void> {
  "use server";
  const agentId = (formData.get("agentId") as string | null) ?? "";
  if (!agentId) return;
  const { role, tenant, agent } = await assertAgentAccess(agentId);
  if (!canManageMembers(role)) {
    redirect(`/app/agents/${agentId}?error=forbidden`);
  }
  if (agent.status !== "revoked") {
    await tenant.agent.update({
      where: { id: agentId },
      data: { status: "active" },
    });
  }
  revalidatePath(`/app/agents/${agentId}`);
  revalidatePath(`/app/agents`);
  redirect(`/app/agents/${agentId}?ok=resumed`);
}

async function revokeAction(formData: FormData): Promise<void> {
  "use server";
  const agentId = (formData.get("agentId") as string | null) ?? "";
  if (!agentId) return;
  const { role, tenant } = await assertAgentAccess(agentId);
  if (!canManageOrg(role)) {
    redirect(`/app/agents/${agentId}?error=forbidden`);
  }
  await tenant.agent.update({
    where: { id: agentId },
    data: { status: "revoked" },
  });
  revalidatePath(`/app/agents/${agentId}`);
  revalidatePath(`/app/agents`);
  redirect(`/app/agents?ok=revoked`);
}

async function grantBrainAction(formData: FormData): Promise<void> {
  "use server";
  const agentId = (formData.get("agentId") as string | null) ?? "";
  const brainId = (formData.get("brainId") as string | null) ?? "";
  const rawRole = (formData.get("role") as string | null) ?? "viewer";
  if (!agentId || !brainId) return;

  const allowedRoles = new Set(["viewer", "editor", "owner"]);
  if (!allowedRoles.has(rawRole)) {
    redirect(`/app/agents/${agentId}?error=invalid-role`);
  }

  const { user, tenant, agent } = await assertAgentAccess(agentId);

  if (agent.status === "revoked") {
    redirect(`/app/agents/${agentId}?error=agent-revoked`);
  }

  // Caller must own the brain.
  const callerOwner = await tenant.brainAccess.findFirst({
    where: { brainId, userId: user.id, role: "owner" },
    select: { id: true },
  });
  if (!callerOwner) {
    redirect(`/app/agents/${agentId}?error=not-brain-owner`);
  }

  // Confirm brain exists in this tenant (org boundary = DB boundary).
  const brain = await tenant.brain.findFirst({
    where: { id: brainId },
    select: { id: true },
  });
  if (!brain) {
    redirect(`/app/agents/${agentId}?error=brain-not-found`);
  }

  const existing = await tenant.brainAccess.findFirst({
    where: { brainId, agentId },
    select: { id: true },
  });

  if (existing) {
    await tenant.brainAccess.update({
      where: { id: existing.id },
      data: { role: rawRole },
    });
  } else {
    await tenant.brainAccess.create({
      data: {
        brainId,
        agentId,
        role: rawRole,
      },
    });
  }

  revalidatePath(`/app/agents/${agentId}`);
  redirect(`/app/agents/${agentId}?ok=granted`);
}

async function revokeBrainAction(formData: FormData): Promise<void> {
  "use server";
  const agentId = (formData.get("agentId") as string | null) ?? "";
  const brainId = (formData.get("brainId") as string | null) ?? "";
  if (!agentId || !brainId) return;

  const { user, tenant } = await assertAgentAccess(agentId);

  const callerOwner = await tenant.brainAccess.findFirst({
    where: { brainId, userId: user.id, role: "owner" },
    select: { id: true },
  });
  if (!callerOwner) {
    redirect(`/app/agents/${agentId}?error=not-brain-owner`);
  }

  await tenant.brainAccess.deleteMany({
    where: { brainId, agentId },
  });

  revalidatePath(`/app/agents/${agentId}`);
  redirect(`/app/agents/${agentId}?ok=revoked-brain`);
}

export default async function AgentDetailPage({
  params,
  searchParams,
}: PageProps) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const { error, ok } = await searchParams;

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) redirect("/app/agents?error=no-active-org");

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId: organizationId! },
    select: { role: true },
  });
  if (!membership) notFound();

  const role = membership.role as OrgRole;
  const tenant = await tenantDbFor(organizationId!);
  const agent = await loadAgent(tenant, id);
  if (!agent) notFound();

  const [grants, activity, orgBrainsRaw] = await Promise.all([
    loadBrainGrants(tenant, agent.id),
    loadActivity(tenant, agent.id, 50),
    tenant.brain.findMany({
      where: {
        access: { some: { userId: user.id, role: "owner" } },
      },
      select: { id: true, name: true, type: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const grantedBrainIds = new Set(grants.map((g) => g.brainId));
  const grantableBrains = orgBrainsRaw.filter(
    (b) => !grantedBrainIds.has(b.id),
  );

  const canManage = canManageMembers(role);
  const canRevoke = canManageOrg(role);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <Link
          href="/app/agents"
          className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
        >
          &larr; agents
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              agent
            </p>
            <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
              {agent.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
              <StatusBadge status={agent.status} />
              <span className="text-[var(--color-faint)]">&middot;</span>
              <span>id: {agent.id}</span>
              <span className="text-[var(--color-faint)]">&middot;</span>
              <span>created {formatDate(agent.createdAt)}</span>
            </div>
            {agent.description && (
              <p className="max-w-[620px] text-[13px] leading-6 text-[var(--color-muted)]">
                {agent.description}
              </p>
            )}
          </div>

          {canManage && agent.status !== "revoked" && (
            <div className="flex flex-wrap items-center gap-2">
              {agent.status === "active" ? (
                <form action={pauseAction}>
                  <input type="hidden" name="agentId" value={agent.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-md border border-yellow-500/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-yellow-300 transition hover:border-yellow-500/70 hover:bg-white/[0.02]"
                  >
                    pause
                  </button>
                </form>
              ) : (
                <form action={resumeAction}>
                  <input type="hidden" name="agentId" value={agent.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02]"
                  >
                    resume
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </section>

      {(error || ok) && <FlashBanner error={error} ok={ok} />}

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            brains
          </p>
          <span className="font-mono text-[11px] text-[var(--color-muted)]">
            {grants.length} granted
          </span>
        </div>

        {grants.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-6 text-[13px] leading-6 text-[var(--color-muted)]">
            This agent has access to no brains yet. Grant one below.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-white/10 divide-y divide-white/5">
            {grants.map((g) => (
              <li
                key={g.accessId}
                className="flex flex-col gap-2 bg-[var(--color-panel)]/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[13px] text-[var(--color-ink)]">
                    {g.brainName}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
                    {g.brainType} &middot; role {g.role} &middot; granted{" "}
                    {formatDate(g.grantedAt)}
                  </span>
                </div>
                <form action={revokeBrainAction}>
                  <input type="hidden" name="agentId" value={agent.id} />
                  <input type="hidden" name="brainId" value={g.brainId} />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-md border border-red-500/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-red-300 transition hover:border-red-500/70 hover:bg-red-500/10"
                  >
                    revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {agent.status !== "revoked" && grantableBrains.length > 0 && (
          <form
            action={grantBrainAction}
            className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/60 p-5 sm:flex-row sm:items-end"
          >
            <input type="hidden" name="agentId" value={agent.id} />
            <div className="flex flex-1 flex-col gap-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
                grant access to a brain
              </label>
              <select
                name="brainId"
                required
                className="w-full rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-1.5 font-mono text-[12px] text-[var(--color-ink)] focus:border-white/20 focus:outline-none"
              >
                <option value="" disabled>
                  select a brain&hellip;
                </option>
                {grantableBrains.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.type})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2 sm:w-[180px]">
              <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
                role
              </label>
              <select
                name="role"
                defaultValue="viewer"
                className="w-full rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-1.5 font-mono text-[12px] text-[var(--color-ink)] focus:border-white/20 focus:outline-none"
              >
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="owner">owner</option>
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02]"
            >
              grant
            </button>
          </form>
        )}
        {agent.status !== "revoked" && grantableBrains.length === 0 && grants.length > 0 && (
          <p className="font-mono text-[11px] text-[var(--color-faint)]">
            No further brains you own are available to grant.
          </p>
        )}
      </section>

      <AgentKeysPanel agentId={agent.id} canManage={canManage} />

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            activity
          </p>
          <span className="font-mono text-[11px] text-[var(--color-muted)]">
            last {activity.length}
          </span>
        </div>
        {activity.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-6 font-mono text-[12px] leading-6 text-[var(--color-muted)]">
            $ no events yet &mdash; this agent hasn&rsquo;t performed any recorded
            actions.
          </p>
        ) : (
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/60 p-5 font-mono text-[11px] leading-6 text-[var(--color-ink)]">
            {activity
              .map(
                (e) =>
                  `${e.createdAt.toISOString()}  ${e.operation.padEnd(7, " ")}  ${e.source.padEnd(8, " ")}  ${e.path}`,
              )
              .join("\n")}
          </pre>
        )}
      </section>

      {canRevoke && agent.status !== "revoked" && (
        <section className="rounded-xl border border-red-500/20 bg-red-500/[0.02] p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-red-300">
            danger zone
          </p>
          <h2 className="mt-2 text-[16px] font-light text-[var(--color-ink)]">
            Revoke this agent
          </h2>
          <p className="mt-1 max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
            This flips the agent&rsquo;s status to <code>revoked</code>. The
            record stays around for audit purposes. API keys tied to the agent
            should be regenerated afterwards.
          </p>
          <form action={revokeAction} className="mt-3">
            <input type="hidden" name="agentId" value={agent.id} />
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md border border-red-500/60 bg-red-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-red-200 transition hover:border-red-500 hover:bg-red-500/20"
            >
              revoke agent
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "active"
      ? "border-[var(--color-accent)]/40 text-[var(--color-accent)]"
      : status === "paused"
        ? "border-yellow-500/40 text-yellow-300"
        : "border-red-500/40 text-red-300";
  return (
    <span
      className={`inline-flex w-fit items-center rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${styles}`}
    >
      {status}
    </span>
  );
}

function FlashBanner({ error, ok }: { error?: string; ok?: string }) {
  const msg = error ? errorCopy(error) : ok ? okCopy(ok) : null;
  if (!msg) return null;
  return (
    <section
      className={`rounded-xl border px-4 py-3 font-mono text-[12px] ${
        error
          ? "border-red-500/30 bg-red-500/5 text-red-300"
          : "border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 text-[var(--color-accent)]"
      }`}
    >
      {msg}
    </section>
  );
}

function errorCopy(code: string): string {
  switch (code) {
    case "forbidden":
      return "You need owner or admin access to do that.";
    case "invalid-role":
      return "Pick a valid role: viewer, editor, or owner.";
    case "not-brain-owner":
      return "Only the brain owner can change access.";
    case "brain-not-found":
      return "Brain not found in this organization.";
    case "agent-revoked":
      return "This agent has been revoked.";
    default:
      return `Error: ${code}`;
  }
}

function okCopy(code: string): string {
  switch (code) {
    case "paused":
      return "Agent paused.";
    case "resumed":
      return "Agent resumed.";
    case "granted":
      return "Brain access granted.";
    case "revoked-brain":
      return "Brain access revoked.";
    default:
      return "Done.";
  }
}

function formatDate(d: Date | string): string {
  const dd = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dd.getTime())) return String(d);
  return dd.toISOString().slice(0, 10);
}
