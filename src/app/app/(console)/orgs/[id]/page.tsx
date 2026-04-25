import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, tenantDbFor } from "@/lib/db";
import {
  currentUser,
  getActiveOrganizationId,
  setActiveOrganizationId,
} from "@/lib/auth";
import type { OrgRole } from "@/lib/tenant";

async function tenantBrainCount(orgId: string): Promise<number> {
  try {
    const tenant = await tenantDbFor(orgId);
    return await tenant.brain.count();
  } catch {
    return 0;
  }
}

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

async function switchToOrgAction(formData: FormData): Promise<void> {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/");

  const orgId = (formData.get("orgId") as string | null) ?? "";
  if (!orgId) return;

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId: orgId },
    select: { organizationId: true },
  });
  if (!membership) return;

  await setActiveOrganizationId(membership.organizationId);
  revalidatePath("/app", "layout");
  redirect(`/app/orgs/${orgId}`);
}

export default async function OrgOverviewPage({ params }: PageProps) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id } = await params;

  const [membership, activeOrgId] = await Promise.all([
    prisma.organizationMembership.findFirst({
      where: { userId: user.id, organizationId: id },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            isPersonal: true,
            planTier: true,
            autoAcceptDomainRequests: true,
            createdAt: true,
            _count: {
              select: {
                memberships: true,
                invitations: true,
                domains: true,
                accessRequests: true,
              },
            },
          },
        },
      },
    }),
    getActiveOrganizationId(),
  ]);

  if (!membership) notFound();

  const org = membership.organization;
  const role = membership.role as OrgRole;
  const isActive = activeOrgId === org.id;
  const brainCount = await tenantBrainCount(org.id);

  const sections: Array<{
    label: string;
    href: string;
    hint: string;
    count?: number;
  }> = [
    {
      label: "Members",
      href: `/app/orgs/${org.id}/members`,
      hint: "Review roles and remove people.",
      count: org._count.memberships,
    },
    {
      label: "Brains",
      href: `/app/brains`,
      hint: "Knowledge bases inside this org.",
      count: brainCount,
    },
    {
      label: "Invitations",
      href: `/app/orgs/${org.id}/invitations`,
      hint: "Outstanding invites and tokens.",
      count: org._count.invitations,
    },
    {
      label: "Access Requests",
      href: `/app/orgs/${org.id}/access-requests`,
      hint: "People asking to join this org.",
      count: org._count.accessRequests,
    },
    {
      label: "Domains",
      href: `/app/orgs/${org.id}/domains`,
      hint: "Claimed email domains and verification.",
      count: org._count.domains,
    },
    {
      label: "Settings",
      href: `/app/orgs/${org.id}/settings`,
      hint: "Rename, configure, or delete the org.",
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <Link
          href="/app/orgs"
          className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
        >
          ← organizations
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              organization
            </p>
            <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
              {org.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
              <span>{org.slug}</span>
              <span className="text-[var(--color-faint)]">·</span>
              <span>{org.planTier}</span>
              {org.isPersonal && (
                <>
                  <span className="text-[var(--color-faint)]">·</span>
                  <span>personal</span>
                </>
              )}
              {isActive && (
                <>
                  <span className="text-[var(--color-faint)]">·</span>
                  <span className="flex items-center gap-1.5 text-[var(--color-accent)]">
                    <span
                      className="size-1.5 rounded-full bg-[var(--color-accent)]"
                      aria-hidden
                    />
                    active
                  </span>
                </>
              )}
            </div>
          </div>
          {!isActive && (
            <form action={switchToOrgAction}>
              <input type="hidden" name="orgId" value={org.id} />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02]"
              >
                switch to this org
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="your role" value={role} />
        <Stat label="members" value={org._count.memberships.toString()} />
        <Stat label="brains" value={brainCount.toString()} />
        <Stat label="plan" value={org.planTier} />
      </section>

      <section className="flex flex-col gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          manage
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group flex flex-col gap-2 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5 transition hover:border-white/20 hover:bg-[var(--color-panel)]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[15px] font-medium text-[var(--color-ink)]">
                  {s.label}
                </h2>
                {typeof s.count === "number" && (
                  <span className="font-mono text-[11px] text-[var(--color-muted)]">
                    {s.count}
                  </span>
                )}
              </div>
              <p className="text-[13px] leading-6 text-[var(--color-muted)]">
                {s.hint}
              </p>
              <span className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition group-hover:text-[var(--color-ink)]">
                open →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-[var(--color-panel)]/50 p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          metadata
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-2 font-mono text-[12px] text-[var(--color-muted)] sm:grid-cols-2">
          <MetaRow k="id" v={org.id} />
          <MetaRow k="slug" v={org.slug} />
          <MetaRow k="created" v={org.createdAt.toISOString()} />
          <MetaRow
            k="auto-accept domains"
            v={org.autoAcceptDomainRequests ? "on" : "off"}
          />
        </dl>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-[var(--color-panel)]/60 p-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
        {label}
      </span>
      <span className="font-mono text-[16px] text-[var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
      <dt className="text-[var(--color-faint)]">{k}</dt>
      <dd className="truncate text-[var(--color-ink)]">{v}</dd>
    </div>
  );
}
