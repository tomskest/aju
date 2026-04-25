import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, tenantDbFor } from "@/lib/db";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import { canManageMembers, type OrgRole } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Agent list page.
 */

async function createAgentAction(formData: FormData): Promise<void> {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/");

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) redirect("/app/agents?error=no-active-org");

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId: organizationId! },
    select: { role: true },
  });
  if (!membership || !canManageMembers(membership.role as OrgRole)) {
    redirect("/app/agents?error=forbidden");
  }

  const rawName = ((formData.get("name") as string | null) ?? "").trim();
  if (!rawName) redirect("/app/agents?error=name-required");
  if (rawName.length > 120) redirect("/app/agents?error=name-too-long");

  const rawDesc = ((formData.get("description") as string | null) ?? "").trim();
  const description = rawDesc.length > 0 ? rawDesc : null;

  const tenant = await tenantDbFor(organizationId!);
  const created = await tenant.agent.create({
    data: {
      name: rawName,
      description,
      createdByUserId: user.id,
      status: "active",
    },
    select: { id: true },
  });

  revalidatePath("/app/agents");
  redirect(`/app/agents/${created.id}`);
}

export default async function AgentsListPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const organizationId = await getActiveOrganizationId();
  const { error, ok } = await searchParams;

  if (!organizationId) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <EmptyState
          title="No active organization."
          body="Pick an organization in the top bar to start managing agents."
        />
      </div>
    );
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { role: true },
  });

  if (!membership) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <EmptyState
          title="No access."
          body="You need to be a member of this organization to manage agents."
        />
      </div>
    );
  }

  const role = membership.role as OrgRole;
  const canCreate = canManageMembers(role);

  const tenant = await tenantDbFor(organizationId);
  const rows = await tenant.agent.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { brainAccess: true } },
    },
  });

  return (
    <div className="flex flex-col gap-10">
      <Header />

      {(error || ok) && (
        <FlashBanner error={error} ok={ok} />
      )}

      {canCreate && (
        <section className="rounded-xl border border-white/10 bg-[var(--color-panel)]/60 p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            create
          </p>
          <h2 className="mt-2 text-[18px] font-light text-[var(--color-ink)]">
            New agent
          </h2>
          <p className="mt-1 max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
            Agents hold scoped API keys and act on brains you grant access to.
          </p>
          <form
            action={createAgentAction}
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start"
          >
            <div className="flex flex-1 flex-col gap-2">
              <input
                type="text"
                name="name"
                required
                maxLength={120}
                placeholder="agent name (e.g. backfill-bot)"
                className="w-full rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-1.5 font-mono text-[12px] text-[var(--color-ink)] placeholder:text-[var(--color-faint)] focus:border-white/20 focus:outline-none"
              />
              <input
                type="text"
                name="description"
                maxLength={2000}
                placeholder="short description (optional)"
                className="w-full rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-1.5 font-mono text-[12px] text-[var(--color-muted)] placeholder:text-[var(--color-faint)] focus:border-white/20 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02]"
            >
              create agent
            </button>
          </form>
        </section>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No agents yet."
          body="Spin up your first agent above. Each agent gets its own scoped API key and can be granted access to specific brains."
        />
      ) : (
        <section className="overflow-hidden rounded-xl border border-white/10">
          <div className="hidden grid-cols-[1.2fr_1.4fr_90px_90px] gap-4 border-b border-white/5 bg-[var(--color-panel)]/60 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)] md:grid">
            <span>name</span>
            <span>description</span>
            <span>status</span>
            <span className="text-right">brains</span>
          </div>
          <ul className="divide-y divide-white/5">
            {rows.map((a) => (
              <li
                key={a.id}
                className="grid grid-cols-1 gap-2 bg-[var(--color-panel)]/40 px-5 py-4 transition hover:bg-[var(--color-panel)]/70 md:grid-cols-[1.2fr_1.4fr_90px_90px] md:items-center md:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Link
                    href={`/app/agents/${a.id}`}
                    className="truncate text-[13px] text-[var(--color-ink)] hover:underline"
                  >
                    {a.name}
                  </Link>
                  <span className="truncate font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
                    id: {a.id}
                  </span>
                </div>
                <span className="truncate text-[12px] text-[var(--color-muted)]">
                  {a.description ?? "—"}
                </span>
                <StatusBadge status={a.status} />
                <span className="font-mono text-[13px] text-[var(--color-ink)] md:text-right">
                  {a._count.brainAccess}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Header() {
  return (
    <section className="flex flex-col gap-2">
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
        agents
      </p>
      <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
        your agents
      </h1>
      <p className="max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
        Non-human principals with scoped access. Create one for every
        automation you want to run, then grant it only the brains it needs.
      </p>
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <section className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
        empty
      </p>
      <h2 className="text-[18px] font-light text-[var(--color-ink)]">{title}</h2>
      <p className="max-w-[460px] text-[13px] leading-6 text-[var(--color-muted)]">
        {body}
      </p>
    </section>
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
  const msg = error
    ? errorCopy(error)
    : ok
      ? okCopy(ok)
      : null;
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
    case "name-required":
      return "Name is required.";
    case "name-too-long":
      return "Name must be 120 characters or fewer.";
    case "no-active-org":
      return "No active organization — pick one from the top bar.";
    case "forbidden":
      return "You need owner or admin access to do that.";
    default:
      return `Error: ${code}`;
  }
}

function okCopy(code: string): string {
  switch (code) {
    case "created":
      return "Agent created.";
    case "paused":
      return "Agent paused.";
    case "resumed":
      return "Agent resumed.";
    case "revoked":
      return "Agent revoked.";
    default:
      return "Done.";
  }
}
