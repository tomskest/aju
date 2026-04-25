import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import {
  canManageOrg,
  type DomainVerificationMethod,
  type OrgRole,
} from "@/lib/tenant";
import {
  getEmailDomain,
  isPublicEmailDomain,
} from "@/lib/billing";
import AutoAcceptToggle from "@/components/app/orgs/AutoAcceptToggle";
import ClaimDomainForm from "@/components/app/orgs/ClaimDomainForm";
import RemoveDomainButton from "@/components/app/orgs/RemoveDomainButton";

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

function methodLabel(m: DomainVerificationMethod | string | null): string {
  switch (m) {
    case "email_match":
      return "email match";
    case "dns_txt":
      return "dns txt";
    case "admin_override":
      return "admin override";
    default:
      return "unverified";
  }
}

export default async function DomainsPage({
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
  if (!canManageOrg(callerRole)) {
    notFound();
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      autoAcceptDomainRequests: true,
    },
  });
  if (!org) notFound();

  const domains = await prisma.organizationDomain.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });

  // Pre-fill the claim form with the user's email domain if it's not public.
  const userDomain = getEmailDomain(user.email);
  const suggestedDomain =
    userDomain && !isPublicEmailDomain(user.email) ? userDomain : null;

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
          · domains
        </p>
        <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
          claimed domains
        </h1>
        <p className="max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
          Domains this org controls. New signups with a matching email domain
          can request access, or join directly if auto-accept is on.
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
          className="rounded-md border border-white/10 px-3 py-1.5 text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
        >
          access requests
        </Link>
        <Link
          href={`/app/orgs/${org.id}/domains`}
          className="rounded-md border border-white/20 bg-white/[0.04] px-3 py-1.5 text-[var(--color-ink)]"
        >
          domains
        </Link>
      </nav>

      <AutoAcceptToggle
        organizationId={org.id}
        initialValue={org.autoAcceptDomainRequests}
      />

      <ClaimDomainForm
        organizationId={org.id}
        suggestedDomain={suggestedDomain}
      />

      {domains.length === 0 ? (
        <section className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            empty
          </p>
          <h2 className="text-[18px] font-light text-[var(--color-ink)]">
            No domains claimed yet
          </h2>
          <p className="max-w-[460px] text-[13px] leading-6 text-[var(--color-muted)]">
            Claim a domain above to let teammates signing up with that domain
            find and join this org.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-white/10">
          <div className="hidden grid-cols-[1.4fr_160px_160px_auto] gap-4 border-b border-white/5 bg-[var(--color-panel)]/60 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)] md:grid">
            <span>domain</span>
            <span>verification</span>
            <span>verified</span>
            <span className="text-right">actions</span>
          </div>
          <ul className="divide-y divide-white/5">
            {domains.map((d) => {
              const verified = d.verifiedAt !== null;
              return (
                <li
                  key={d.id}
                  className="flex flex-col gap-2 bg-[var(--color-panel)]/40 px-5 py-4 transition hover:bg-[var(--color-panel)]/70 md:grid md:grid-cols-[1.4fr_160px_160px_auto] md:items-center md:gap-4"
                >
                  <span className="truncate font-mono text-[13px] text-[var(--color-ink)]">
                    {d.domain}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                    {methodLabel(d.verificationMethod)}
                  </span>
                  <span
                    className={`font-mono text-[11px] ${
                      verified
                        ? "text-[var(--color-ink)]"
                        : "text-[var(--color-faint)]"
                    }`}
                  >
                    {verified ? formatDateTime(d.verifiedAt) : "pending"}
                  </span>
                  <div className="md:justify-self-end">
                    <RemoveDomainButton
                      organizationId={org.id}
                      domainId={d.id}
                      domain={d.domain}
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
