import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma, tenantDbFor } from "@/lib/db";
import { provisionTenant } from "@/lib/tenant";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import { slugify } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** 6-char base36 suffix for slug uniqueness — mirrors /api/orgs POST. */
function shortId(): string {
  let s = "";
  while (s.length < 6) {
    s += Math.random().toString(36).slice(2);
  }
  return s.slice(0, 6);
}

/**
 * Server action: create a new org owned by the caller, then redirect to its
 * settings page. Mirrors the POST /api/orgs handler so form-based callers
 * don't need JavaScript to create.
 */
async function createOrgAction(formData: FormData): Promise<void> {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/");

  const rawName = (formData.get("name") as string | null)?.trim() ?? "";
  if (!rawName) redirect("/app/orgs");
  if (rawName.length > 120) redirect("/app/orgs");

  const baseSlug = slugify(rawName) || "org";

  let orgId: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = `${baseSlug}-${shortId()}`;
    try {
      const created = await prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: rawName,
            slug: candidate,
            isPersonal: false,
            ownerUserId: user.id,
            planTier: "beta_legacy",
          },
          select: { id: true },
        });
        await tx.organizationMembership.create({
          data: {
            organizationId: org.id,
            userId: user.id,
            role: "owner",
            acceptedAt: new Date(),
          },
        });
        return org;
      });
      orgId = created.id;
      break;
    } catch (err) {
      const code = (err as Prisma.PrismaClientKnownRequestError | null)?.code;
      if (code !== "P2002") throw err;
    }
  }

  if (!orgId) redirect("/app/orgs");

  // Provision the per-tenant DB after the control-plane commit. This opens
  // its own connections (Neon API + direct DSN) and must run OUTSIDE the
  // prisma.$transaction above. If it fails we let the error bubble — a
  // half-provisioned org is worse than surfacing the failure, and
  // provisionTenant is idempotent so the user can retry.
  await provisionTenant(orgId);

  redirect(`/app/orgs/${orgId}/settings`);
}

export default async function OrgsListPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const [memberships, activeOrgId] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { userId: user.id },
      include: {
        organization: {
          include: {
            _count: { select: { memberships: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    getActiveOrganizationId(),
  ]);

  // Brain rows live in each org's per-tenant DB. Fetch counts in parallel;
  // a tenant that's still provisioning / unreachable renders as 0 rather
  // than failing the whole page.
  const brainCounts = await Promise.all(
    memberships.map(async (m) => {
      try {
        const tenant = await tenantDbFor(m.organization.id);
        return await tenant.brain.count();
      } catch (err) {
        console.error(
          `[orgs-page] brain count failed for ${m.organization.id}:`,
          err,
        );
        return 0;
      }
    }),
  );

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            organizations
          </p>
          <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
            your organizations
          </h1>
          <p className="max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
            Each organization is an isolated workspace with its own members,
            brains, invitations, and domains. Switch between them from the top
            bar.
          </p>
        </div>
        <form
          action={createOrgAction}
          className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center"
        >
          <input
            type="text"
            name="name"
            required
            maxLength={120}
            placeholder="new org name"
            className="w-full rounded-md border border-white/10 bg-[var(--color-panel)]/60 px-3 py-1.5 font-mono text-[12px] text-[var(--color-ink)] placeholder:text-[var(--color-faint)] focus:border-white/20 focus:outline-none sm:w-[220px]"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02]"
          >
            create organization
          </button>
        </form>
      </section>

      {memberships.length === 0 ? (
        <section className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            empty
          </p>
          <h2 className="text-[18px] font-light text-[var(--color-ink)]">
            No organizations yet.
          </h2>
          <p className="max-w-[460px] text-[13px] leading-6 text-[var(--color-muted)]">
            Create one to invite collaborators and group brains together.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-white/10">
          <div className="hidden grid-cols-[1.4fr_1fr_100px_90px_90px_80px] gap-4 border-b border-white/5 bg-[var(--color-panel)]/60 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)] md:grid">
            <span>name</span>
            <span>slug</span>
            <span>role</span>
            <span className="text-right">members</span>
            <span className="text-right">brains</span>
            <span className="text-right">active</span>
          </div>
          <ul className="divide-y divide-white/5">
            {memberships.map((m, i) => {
              const o = m.organization;
              const isActive = activeOrgId === o.id;
              return (
                <li
                  key={o.id}
                  className="grid grid-cols-1 gap-2 bg-[var(--color-panel)]/40 px-5 py-4 transition hover:bg-[var(--color-panel)]/70 md:grid-cols-[1.4fr_1fr_100px_90px_90px_80px] md:items-center md:gap-4"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      href={`/app/orgs/${o.id}`}
                      className="truncate text-[13px] text-[var(--color-ink)] hover:underline"
                    >
                      {o.name}
                    </Link>
                    <span className="truncate font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
                      {o.isPersonal ? "personal · " : ""}
                      {o.planTier}
                    </span>
                  </div>
                  <span className="truncate font-mono text-[12px] text-[var(--color-muted)]">
                    {o.slug}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                    {m.role}
                  </span>
                  <span className="font-mono text-[13px] text-[var(--color-ink)] md:text-right">
                    {o._count.memberships}
                  </span>
                  <span className="font-mono text-[13px] text-[var(--color-ink)] md:text-right">
                    {brainCounts[i]}
                  </span>
                  <span className="flex items-center gap-2 md:justify-end">
                    {isActive ? (
                      <>
                        <span
                          className="size-2 rounded-full bg-[var(--color-accent)]"
                          aria-hidden
                        />
                        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
                          active
                        </span>
                      </>
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                        —
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
