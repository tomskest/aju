import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import {
  canManageMembers,
  type OrgRole,
} from "@/lib/tenant";
import RevokeInvitationButton from "@/components/app/orgs/RevokeInvitationButton";

export const dynamic = "force-dynamic";

function formatDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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

export default async function InvitationsPage({
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
  if (!canManageMembers(callerRole)) {
    notFound();
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!org) notFound();

  const now = new Date();
  const invitations = await prisma.invitation.findMany({
    where: {
      organizationId,
      acceptedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  // Look up the inviters' emails so the table can show who sent it.
  const inviterIds = Array.from(
    new Set(invitations.map((inv) => inv.createdBy)),
  );
  const inviterRows = inviterIds.length
    ? await prisma.user.findMany({
        where: { id: { in: inviterIds } },
        select: { id: true, email: true },
      })
    : [];
  const inviterMap = new Map(inviterRows.map((u) => [u.id, u.email]));

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
          · invitations
        </p>
        <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
          pending invitations
        </h1>
        <p className="max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
          Invitations that have been sent but not yet accepted or expired.
          Revoke any that are no longer needed.
        </p>
      </section>

      <nav className="flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-[0.2em]">
        <Link
          href={`/app/orgs/${org.id}/members`}
          className="rounded-md border border-white/10 px-3 py-1.5 text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
        >
          members
        </Link>
        <Link
          href={`/app/orgs/${org.id}/invitations`}
          className="rounded-md border border-white/20 bg-white/[0.04] px-3 py-1.5 text-[var(--color-ink)]"
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

      {invitations.length === 0 ? (
        <section className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            empty
          </p>
          <h2 className="text-[18px] font-light text-[var(--color-ink)]">
            No pending invitations
          </h2>
          <p className="max-w-[460px] text-[13px] leading-6 text-[var(--color-muted)]">
            Invite new members from the{" "}
            <Link
              href={`/app/orgs/${org.id}/members`}
              className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
            >
              members page
            </Link>
            . They&rsquo;ll show up here until they accept or the invitation
            expires.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-white/10">
          <div className="hidden grid-cols-[1.4fr_100px_1.2fr_160px_auto] gap-4 border-b border-white/5 bg-[var(--color-panel)]/60 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)] md:grid">
            <span>email</span>
            <span>role</span>
            <span>sent by</span>
            <span>expires</span>
            <span className="text-right">actions</span>
          </div>
          <ul className="divide-y divide-white/5">
            {invitations.map((inv) => {
              const role = inv.role as OrgRole;
              const inviterEmail = inviterMap.get(inv.createdBy) ?? "—";
              return (
                <li
                  key={inv.id}
                  className="grid grid-cols-1 gap-2 bg-[var(--color-panel)]/40 px-5 py-4 transition hover:bg-[var(--color-panel)]/70 md:grid-cols-[1.4fr_100px_1.2fr_160px_auto] md:items-center md:gap-4"
                >
                  <span className="truncate font-mono text-[13px] text-[var(--color-ink)]">
                    {inv.email}
                  </span>
                  <span>
                    <RoleBadge role={role} />
                  </span>
                  <span className="truncate font-mono text-[12px] text-[var(--color-muted)]">
                    {inviterEmail}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--color-muted)]">
                    {formatDateTime(inv.expiresAt)}
                  </span>
                  <div className="md:justify-self-end">
                    <RevokeInvitationButton
                      orgId={organizationId}
                      invitationId={inv.id}
                      email={inv.email}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
