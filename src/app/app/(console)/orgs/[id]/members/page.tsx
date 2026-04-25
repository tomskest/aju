import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import {
  canManageMembers,
  type OrgRole,
} from "@/lib/tenant";
import InviteMemberForm from "@/components/app/orgs/InviteMemberForm";
import MemberRowActions from "@/components/app/orgs/MemberRowActions";

export const dynamic = "force-dynamic";

function initialFor(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "?";
  return trimmed[0].toUpperCase();
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return "—";
  }
}

function RoleBadge({ role }: { role: OrgRole }) {
  const tone =
    role === "owner"
      ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
      : role === "admin"
        ? "border-white/20 bg-white/[0.05] text-[var(--color-ink)]"
        : "border-white/10 bg-[var(--color-panel)]/60 text-[var(--color-muted)]";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] ${tone}`}
    >
      {role}
    </span>
  );
}

export default async function MembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: organizationId } = await params;

  const user = await currentUser();
  if (!user) redirect("/");

  const callerMembership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: user.id },
    },
    select: { role: true },
  });

  if (!callerMembership) {
    notFound();
  }

  const callerRole = callerMembership.role as OrgRole;
  const callerCanManage = canManageMembers(callerRole);

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!org) notFound();

  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const ownerCount = memberships.reduce(
    (n, m) => (m.role === "owner" ? n + 1 : n),
    0,
  );

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          <Link
            href={`/app/orgs/${org.id}/members`}
            className="transition hover:text-[var(--color-ink)]"
          >
            {org.slug}
          </Link>{" "}
          · members
        </p>
        <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
          {org.name}
        </h1>
        <p className="max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
          Everyone with access to this organization. Owners and admins can
          change roles, remove members, and send invitations.
        </p>
      </section>

      <nav className="flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-[0.2em]">
        <Link
          href={`/app/orgs/${org.id}/members`}
          className="rounded-md border border-white/20 bg-white/[0.04] px-3 py-1.5 text-[var(--color-ink)]"
        >
          members
        </Link>
        <Link
          href={`/app/orgs/${org.id}/invitations`}
          className="rounded-md border border-white/10 px-3 py-1.5 text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
        >
          invitations
        </Link>
        <Link
          href={`/app/orgs/${org.id}/access-requests`}
          className="rounded-md border border-white/10 px-3 py-1.5 text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
        >
          access requests
        </Link>
        <Link
          href={`/app/orgs/${org.id}/domains`}
          className="rounded-md border border-white/10 px-3 py-1.5 text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
        >
          domains
        </Link>
      </nav>

      {callerCanManage && <InviteMemberForm organizationId={org.id} />}

      <section className="overflow-hidden rounded-xl border border-white/10">
        <div className="hidden grid-cols-[32px_1.6fr_1fr_100px_120px_120px_auto] gap-4 border-b border-white/5 bg-[var(--color-panel)]/60 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)] md:grid">
          <span aria-hidden />
          <span>email</span>
          <span>name</span>
          <span>role</span>
          <span>invited</span>
          <span>joined</span>
          <span className="text-right">actions</span>
        </div>

        <ul className="divide-y divide-white/5">
          {memberships.map((m) => {
            const role = m.role as OrgRole;
            const isLastOwner = role === "owner" && ownerCount <= 1;
            const canChangeRole = callerCanManage && !isLastOwner;
            const canRemove = callerCanManage && !isLastOwner;

            return (
              <li
                key={m.id}
                className="grid grid-cols-[32px_1fr] gap-3 bg-[var(--color-panel)]/40 px-5 py-4 transition hover:bg-[var(--color-panel)]/70 md:grid-cols-[32px_1.6fr_1fr_100px_120px_120px_auto] md:items-center md:gap-4"
              >
                <div
                  className="flex size-7 items-center justify-center rounded-md border border-white/10 bg-[var(--color-panel)] font-mono text-[11px] text-[var(--color-muted)]"
                  aria-hidden
                >
                  {initialFor(m.user.name || m.user.email)}
                </div>

                <div className="flex min-w-0 flex-col gap-0.5 md:gap-0">
                  <span className="truncate font-mono text-[13px] text-[var(--color-ink)]">
                    {m.user.email}
                  </span>
                  <span className="text-[11px] text-[var(--color-muted)] md:hidden">
                    {m.user.name || "—"}
                  </span>
                </div>

                <span className="hidden truncate text-[13px] text-[var(--color-ink)] md:inline">
                  {m.user.name || "—"}
                </span>

                <span className="hidden md:inline">
                  <RoleBadge role={role} />
                </span>

                <span className="hidden font-mono text-[11px] text-[var(--color-muted)] md:inline">
                  {formatDate(m.invitedAt ?? m.createdAt)}
                </span>

                <span className="hidden font-mono text-[11px] text-[var(--color-muted)] md:inline">
                  {formatDate(m.acceptedAt)}
                </span>

                <div className="md:justify-self-end">
                  <MemberRowActions
                    organizationId={org.id}
                    userId={m.user.id}
                    email={m.user.email}
                    currentRole={role}
                    canManage={callerCanManage}
                    canChangeRole={canChangeRole}
                    canRemove={canRemove}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
