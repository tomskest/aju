import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentAuth, currentUser } from "@/lib/auth";
import JoinActions from "@/components/app/JoinActions";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

function readOrgSlug(searchParams: SearchParams): string | null {
  const raw = searchParams.org;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== "string") return null;
  if (!/^[a-z0-9-]{1,64}$/.test(value)) return null;
  return value;
}

/**
 * Resolve the authenticated user, preferring the richer `currentAuth`
 * shape when the sibling helper is available. Falls back to `currentUser`
 * on any failure so the page degrades gracefully during the handoff.
 */
async function resolveUser() {
  try {
    const auth = await currentAuth();
    if (auth && typeof auth === "object" && "user" in auth) {
      const u = (auth as { user?: { id: string } | null }).user;
      if (u) return u;
    }
  } catch {
    // currentAuth may throw or not exist yet — fall through.
  }
  return await currentUser();
}

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const slug = readOrgSlug(params);

  const user = await resolveUser();
  if (!user) redirect("/");

  // Bad or missing slug → quietly bounce to the app home. No error UI
  // because this page is reached by email redirect; confusion is worse
  // than silent recovery.
  if (!slug) redirect("/app");

  const org = await prisma.organization.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      isPersonal: true,
      domains: {
        where: { verifiedAt: { not: null } },
        select: { id: true },
        take: 1,
      },
    },
  });

  // Only show the prompt when the org exists, is a real team workspace
  // (not a personal one), and has at least one verified domain.
  if (!org || org.isPersonal || org.domains.length === 0) {
    redirect("/app");
  }

  // Already a member → don't prompt to re-join (the access-request API
  // would reject with `already_member` anyway). Send them straight to
  // the workspace.
  const existingMembership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: user.id,
      },
    },
    select: { id: true },
  });
  if (existingMembership) redirect("/app");

  return (
    <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-[460px] flex-col items-center gap-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-accent)]">
          team workspace found
        </p>

        <div className="flex flex-col gap-3">
          <h1 className="text-[26px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
            your teammates are on aju
          </h1>
          <p className="text-[14px] leading-6 text-[var(--color-muted)]">
            someone at{" "}
            <span className="text-[var(--color-ink)]">{org.name}</span> is
            already using aju. would you like to request access to their
            workspace?
          </p>
        </div>

        <div className="w-full rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
          <JoinActions organizationId={org.id} />
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
            an owner or admin will be notified to approve
          </p>
        </div>
      </div>
    </div>
  );
}
