import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import {
  canManageMembers,
  type OrgRole,
} from "@/lib/tenant";
import AccessRequestActions from "@/components/app/orgs/AccessRequestActions";

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

export default async function AccessRequestsPage({
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
  const requests = await prisma.accessRequest.findMany({
    where: {
      organizationId,
      status: "pending",
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

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
          · access requests
        </p>
        <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
          pending access requests
        </h1>
        <p className="max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
          People who have asked to join this org. Approve to add them as a
          member, or deny to close the request.
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
          className="rounded-md border border-white/10 px-3 py-1.5 text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
        >
          invitations
        </Link>
        <Link
          href={`/app/orgs/${org.id}/access-requests`}
          className="rounded-md border border-white/20 bg-white/[0.04] px-3 py-1.5 text-[var(--color-ink)]"
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

      {requests.length === 0 ? (
        <section className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            empty
          </p>
          <h2 className="text-[18px] font-light text-[var(--color-ink)]">
            No pending access requests
          </h2>
          <p className="max-w-[460px] text-[13px] leading-6 text-[var(--color-muted)]">
            When someone signs up with an email on one of your claimed
            domains, their request will appear here.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-white/10">
          <div className="hidden grid-cols-[1.3fr_160px_1.4fr_auto] gap-4 border-b border-white/5 bg-[var(--color-panel)]/60 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)] md:grid">
            <span>email</span>
            <span>requested</span>
            <span>message</span>
            <span className="text-right">actions</span>
          </div>
          <ul className="divide-y divide-white/5">
            {requests.map((req) => (
              <li
                key={req.id}
                className="flex flex-col gap-2 bg-[var(--color-panel)]/40 px-5 py-4 transition hover:bg-[var(--color-panel)]/70 md:grid md:grid-cols-[1.3fr_160px_1.4fr_auto] md:items-center md:gap-4"
              >
                <span className="truncate font-mono text-[13px] text-[var(--color-ink)]">
                  {req.email}
                </span>
                <span className="font-mono text-[11px] text-[var(--color-muted)]">
                  {formatDateTime(req.createdAt)}
                </span>
                <span className="text-[12px] leading-5 text-[var(--color-muted)]">
                  {req.message?.trim() ? (
                    <span className="italic">&ldquo;{req.message}&rdquo;</span>
                  ) : (
                    <span className="text-[var(--color-faint)]">
                      no message
                    </span>
                  )}
                </span>
                <div className="md:justify-self-end">
                  <AccessRequestActions requestId={req.id} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
