import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { PrismaClient as PrismaClientTenant } from "@prisma/client-tenant";
import { prisma, tenantDbFor } from "@/lib/db";
import {
  currentUser,
  getActiveOrganizationId,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

const NAME_MAX_LEN = 64;
type BrainRole = "owner" | "editor" | "viewer";

/**
 * Resolve a brain the caller can see inside a given tenant DB. Callers with
 * an explicit BrainAccess row get their real role; members of the brain's
 * org get editor access to `type: "org"` brains via the membership fallback.
 * Personal brains stay private to their owner.
 */
async function loadAccessibleBrain(
  tenant: PrismaClientTenant,
  userId: string,
  organizationId: string,
  brainId: string,
) {
  const brain = await tenant.brain.findUnique({
    where: { id: brainId },
    include: {
      _count: { select: { documents: true, files: true } },
    },
  });
  if (!brain) return null;

  const access = await tenant.brainAccess.findUnique({
    where: { brainId_userId: { brainId, userId } },
  });
  if (access) {
    return { brain, role: access.role as BrainRole };
  }

  if (brain.type !== "org") return null;

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, organizationId },
    select: { id: true },
  });
  if (membership) {
    return { brain, role: "editor" as BrainRole };
  }

  return null;
}

async function renameBrainAction(formData: FormData): Promise<void> {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/");

  const brainId = (formData.get("brainId") as string | null) ?? "";
  if (!brainId) return;

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) notFound();

  const tenant = await tenantDbFor(organizationId!);
  const loaded = await loadAccessibleBrain(
    tenant,
    user.id,
    organizationId!,
    brainId,
  );
  if (!loaded) notFound();
  if (loaded.role !== "owner") {
    redirect(`/app/brains/${brainId}?error=forbidden`);
  }

  const rawName = ((formData.get("name") as string | null) ?? "").trim();
  if (!rawName) {
    redirect(`/app/brains/${brainId}?error=name-required`);
  }
  if (rawName.length > NAME_MAX_LEN) {
    redirect(`/app/brains/${brainId}?error=name-too-long`);
  }

  await tenant.brain.update({
    where: { id: brainId },
    data: { name: rawName },
  });
  revalidatePath(`/app/brains/${brainId}`, "layout");
  revalidatePath("/app/brains", "layout");
  redirect(`/app/brains/${brainId}?ok=renamed`);
}

const GRANT_ROLES: readonly BrainRole[] = ["viewer", "editor", "owner"];

function isGrantRole(s: string): s is BrainRole {
  return (GRANT_ROLES as readonly string[]).includes(s);
}

async function inviteMemberAction(formData: FormData): Promise<void> {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/");

  const brainId = (formData.get("brainId") as string | null) ?? "";
  if (!brainId) return;
  const organizationId = await getActiveOrganizationId();
  if (!organizationId) notFound();

  const tenant = await tenantDbFor(organizationId!);
  const loaded = await loadAccessibleBrain(
    tenant,
    user.id,
    organizationId!,
    brainId,
  );
  if (!loaded) notFound();
  if (loaded.role !== "owner") {
    redirect(`/app/brains/${brainId}?error=forbidden`);
  }

  const email = ((formData.get("email") as string | null) ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    redirect(`/app/brains/${brainId}?error=email-required`);
  }
  const rawRole = ((formData.get("role") as string | null) ?? "editor").trim();
  if (!isGrantRole(rawRole)) {
    redirect(`/app/brains/${brainId}?error=invalid-role`);
  }
  const role = rawRole;

  const target = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!target) {
    redirect(`/app/brains/${brainId}?error=user-not-found`);
  }

  const targetMembership = await prisma.organizationMembership.findFirst({
    where: { userId: target!.id, organizationId: organizationId! },
    select: { id: true },
  });
  if (!targetMembership) {
    redirect(`/app/brains/${brainId}?error=user-not-in-org`);
  }

  await tenant.brainAccess.upsert({
    where: { brainId_userId: { brainId, userId: target!.id } },
    create: { brainId, userId: target!.id, role },
    update: { role },
  });

  revalidatePath(`/app/brains/${brainId}`, "layout");
  redirect(`/app/brains/${brainId}?ok=member-added`);
}

async function updateMemberRoleAction(formData: FormData): Promise<void> {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/");

  const brainId = (formData.get("brainId") as string | null) ?? "";
  const targetUserId = (formData.get("userId") as string | null) ?? "";
  if (!brainId || !targetUserId) return;

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) notFound();

  const tenant = await tenantDbFor(organizationId!);
  const loaded = await loadAccessibleBrain(
    tenant,
    user.id,
    organizationId!,
    brainId,
  );
  if (!loaded) notFound();
  if (loaded.role !== "owner") {
    redirect(`/app/brains/${brainId}?error=forbidden`);
  }

  const rawRole = ((formData.get("role") as string | null) ?? "").trim();
  if (!isGrantRole(rawRole)) {
    redirect(`/app/brains/${brainId}?error=invalid-role`);
  }
  const role = rawRole;

  const existing = await tenant.brainAccess.findUnique({
    where: { brainId_userId: { brainId, userId: targetUserId } },
    select: { id: true, role: true },
  });
  if (!existing) {
    redirect(`/app/brains/${brainId}?error=member-missing`);
  }

  // Last-owner guard mirrors the API.
  if (existing!.role === "owner" && role !== "owner") {
    const ownerCount = await tenant.brainAccess.count({
      where: { brainId, role: "owner", userId: { not: null } },
    });
    if (ownerCount <= 1) {
      redirect(`/app/brains/${brainId}?error=last-owner`);
    }
  }

  await tenant.brainAccess.update({
    where: { id: existing!.id },
    data: { role },
  });

  revalidatePath(`/app/brains/${brainId}`, "layout");
  redirect(`/app/brains/${brainId}?ok=member-updated`);
}

async function removeMemberAction(formData: FormData): Promise<void> {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/");

  const brainId = (formData.get("brainId") as string | null) ?? "";
  const targetUserId = (formData.get("userId") as string | null) ?? "";
  if (!brainId || !targetUserId) return;

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) notFound();

  const tenant = await tenantDbFor(organizationId!);
  const loaded = await loadAccessibleBrain(
    tenant,
    user.id,
    organizationId!,
    brainId,
  );
  if (!loaded) notFound();
  if (loaded.role !== "owner") {
    redirect(`/app/brains/${brainId}?error=forbidden`);
  }

  const existing = await tenant.brainAccess.findUnique({
    where: { brainId_userId: { brainId, userId: targetUserId } },
    select: { id: true, role: true },
  });
  if (!existing) {
    redirect(`/app/brains/${brainId}?error=member-missing`);
  }

  if (existing!.role === "owner") {
    const ownerCount = await tenant.brainAccess.count({
      where: { brainId, role: "owner", userId: { not: null } },
    });
    if (ownerCount <= 1) {
      redirect(`/app/brains/${brainId}?error=last-owner`);
    }
  }

  await tenant.brainAccess.delete({ where: { id: existing!.id } });

  revalidatePath(`/app/brains/${brainId}`, "layout");
  redirect(`/app/brains/${brainId}?ok=member-removed`);
}

async function deleteBrainAction(formData: FormData): Promise<void> {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/");

  const brainId = (formData.get("brainId") as string | null) ?? "";
  if (!brainId) return;

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) notFound();

  const tenant = await tenantDbFor(organizationId!);
  const loaded = await loadAccessibleBrain(
    tenant,
    user.id,
    organizationId!,
    brainId,
  );
  if (!loaded) notFound();
  if (loaded.role !== "owner") {
    redirect(`/app/brains/${brainId}?error=forbidden`);
  }

  const confirm = ((formData.get("confirm") as string | null) ?? "").trim();
  if (confirm !== loaded.brain.name) {
    redirect(`/app/brains/${brainId}?error=confirm-mismatch`);
  }

  // Last-brain guard mirrors the API: refuse if this is the caller's only
  // owned brain.
  const ownedCount = await tenant.brainAccess.count({
    where: { userId: user.id, role: "owner" },
  });
  if (ownedCount <= 1) {
    redirect(`/app/brains/${brainId}?error=last-brain`);
  }

  await tenant.brain.delete({ where: { id: brainId } });
  revalidatePath("/app/brains", "layout");
  redirect("/app/brains?ok=deleted");
}

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "only the owner can do that.",
  "name-required": "please provide a name.",
  "name-too-long": `name must be ${NAME_MAX_LEN} characters or fewer.`,
  "confirm-mismatch": "the name you typed didn't match.",
  "last-brain": "can't delete your only owned brain — create another first.",
  "email-required": "enter an email to invite.",
  "invalid-role": "role must be viewer, editor, or owner.",
  "user-not-found": "no user with that email exists.",
  "user-not-in-org": "user must be a member of this org first.",
  "member-missing": "that member is no longer on this brain.",
  "last-owner":
    "this is the last owner — promote someone else to owner first.",
};

const OK_MESSAGES: Record<string, string> = {
  renamed: "renamed.",
  "member-added": "member added.",
  "member-updated": "role updated.",
  "member-removed": "member removed.",
};

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

function RoleBadge({ role }: { role: BrainRole }) {
  const tone =
    role === "owner"
      ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
      : role === "editor"
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

export default async function BrainDetailPage({
  params,
  searchParams,
}: PageProps) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const sp = await searchParams;

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) notFound();

  // Org slug for the breadcrumb-ish header line.
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId! },
    select: { id: true, name: true, slug: true },
  });

  const tenant = await tenantDbFor(organizationId!);
  const loaded = await loadAccessibleBrain(
    tenant,
    user.id,
    organizationId!,
    id,
  );
  if (!loaded) notFound();
  const { brain, role } = loaded;
  const canManage = role === "owner";

  const [membersRaw, documents] = await Promise.all([
    // Only list user-backed access rows under "members" — agent-backed rows
    // surface on the agent detail page instead.
    tenant.brainAccess.findMany({
      where: { brainId: brain.id, userId: { not: null } },
      orderBy: { createdAt: "asc" },
    }),
    tenant.vaultDocument.findMany({
      where: { brainId: brain.id },
      select: {
        id: true,
        path: true,
        title: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);

  // Hydrate user info from the control DB (users live there).
  const userIds = membersRaw
    .map((m) => m.userId)
    .filter((x): x is string => typeof x === "string");
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const members = membersRaw.flatMap((m) => {
    if (!m.userId) return [];
    const u = userById.get(m.userId);
    if (!u) return [];
    return [{ id: m.id, role: m.role, user: u }];
  });

  const errorMessage = sp.error ? ERROR_MESSAGES[sp.error] ?? sp.error : null;
  const okMessage = sp.ok ? OK_MESSAGES[sp.ok] ?? sp.ok : null;

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <Link
          href="/app/brains"
          className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
        >
          ← brains
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              brain
            </p>
            <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
              {brain.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
              <span>{brain.type}</span>
              {organization && (
                <>
                  <span className="text-[var(--color-faint)]">·</span>
                  <Link
                    href={`/app/orgs/${organization.id}`}
                    className="transition hover:text-[var(--color-ink)]"
                  >
                    {organization.slug}
                  </Link>
                </>
              )}
              <span className="text-[var(--color-faint)]">·</span>
              <RoleBadge role={role} />
            </div>
          </div>
        </div>
      </section>

      {errorMessage && (
        <div className="rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-panel)]/60 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
            error
          </p>
          <p className="mt-1 text-[13px] text-[var(--color-ink)]">
            {errorMessage}
          </p>
        </div>
      )}
      {okMessage && (
        <div className="rounded-xl border border-white/10 bg-[var(--color-panel)]/60 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
            saved
          </p>
          <p className="mt-1 text-[13px] text-[var(--color-ink)]">{okMessage}</p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="documents" value={brain._count.documents.toString()} />
        <Stat label="files" value={brain._count.files.toString()} />
        <Stat label="your role" value={role} />
        <Stat label="created" value={formatDate(brain.createdAt)} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            members
          </p>
          <span className="font-mono text-[11px] text-[var(--color-faint)]">
            {members.length}
          </span>
        </div>

        {brain.type === "org" && (
          <p className="text-[12px] leading-6 text-[var(--color-muted)]">
            This is an org brain — every member of{" "}
            <span className="text-[var(--color-ink)]">
              {organization?.slug ?? "the org"}
            </span>{" "}
            already has editor access. Use the list below to grant explicit
            owner rights or override roles for specific people.
          </p>
        )}

        {members.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-6">
            <p className="text-[13px] text-[var(--color-muted)]">
              No explicit members yet.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <ul className="divide-y divide-white/5">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="grid grid-cols-1 gap-3 bg-[var(--color-panel)]/40 px-5 py-3 md:grid-cols-[1fr_180px_auto] md:items-center md:gap-4"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-[13px] text-[var(--color-ink)]">
                      {m.user.email}
                    </span>
                    {m.user.name && (
                      <span className="text-[12px] text-[var(--color-muted)]">
                        {m.user.name}
                      </span>
                    )}
                  </div>
                  {canManage && m.user.id !== user.id ? (
                    <form
                      action={updateMemberRoleAction}
                      className="flex items-center gap-2 md:justify-end"
                    >
                      <input type="hidden" name="brainId" value={brain.id} />
                      <input type="hidden" name="userId" value={m.user.id} />
                      <select
                        name="role"
                        defaultValue={m.role}
                        className="rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink)] focus:border-white/20 focus:outline-none"
                      >
                        <option value="viewer">viewer</option>
                        <option value="editor">editor</option>
                        <option value="owner">owner</option>
                      </select>
                      <button
                        type="submit"
                        className="inline-flex items-center justify-center rounded-md border border-white/15 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)] transition hover:border-white/30 hover:text-[var(--color-ink)]"
                      >
                        save
                      </button>
                    </form>
                  ) : (
                    <div className="md:text-right">
                      <RoleBadge role={m.role as BrainRole} />
                    </div>
                  )}
                  {canManage && m.user.id !== user.id ? (
                    <form
                      action={removeMemberAction}
                      className="md:text-right"
                    >
                      <input type="hidden" name="brainId" value={brain.id} />
                      <input type="hidden" name="userId" value={m.user.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/30 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-accent)]/[0.08]"
                      >
                        remove
                      </button>
                    </form>
                  ) : (
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)] md:text-right">
                      {m.user.id === user.id ? "you" : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {canManage && (
          <form
            action={inviteMemberAction}
            className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-medium text-[var(--color-ink)]">
                Invite member
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
                owner only
              </span>
            </div>
            <p className="text-[13px] leading-6 text-[var(--color-muted)]">
              Grant a specific user access to this brain. The user must already
              be a member of{" "}
              <span className="text-[var(--color-ink)]">
                {organization?.slug ?? "the org"}
              </span>
              .
            </p>
            <input type="hidden" name="brainId" value={brain.id} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
                  email
                </span>
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="off"
                  placeholder="teammate@example.com"
                  className="rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] focus:border-white/20 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1.5 sm:w-40">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
                  role
                </span>
                <select
                  name="role"
                  defaultValue="editor"
                  className="rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] focus:border-white/20 focus:outline-none"
                >
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="owner">owner</option>
                </select>
              </label>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02]"
              >
                add member
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            recent documents
          </p>
          <span className="font-mono text-[11px] text-[var(--color-faint)]">
            showing {documents.length} of {brain._count.documents}
          </span>
        </div>
        {documents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-6">
            <p className="text-[13px] text-[var(--color-muted)]">
              No documents yet.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <ul className="divide-y divide-white/5">
              {documents.map((d) => (
                <li
                  key={d.id}
                  className="bg-[var(--color-panel)]/40 transition hover:bg-[var(--color-panel)]/70"
                >
                  <Link
                    href={`/app/brains/${brain.id}/documents/${encodeURIComponent(d.path)}`}
                    className="grid grid-cols-1 gap-1 px-5 py-3 md:grid-cols-[1fr_140px] md:items-center md:gap-4"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13px] text-[var(--color-ink)]">
                        {d.title}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--color-faint)]">
                        {d.path}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-[var(--color-muted)] md:text-right">
                      {formatDate(d.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Rename */}
      <section className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium text-[var(--color-ink)]">
            Rename
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
            owner only
          </span>
        </div>
        <p className="text-[13px] leading-6 text-[var(--color-muted)]">
          Rename this brain. CLI callers refer to brains by name, so updating
          it will change how the brain is selected via{" "}
          <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[12px] text-[var(--color-ink)]">
            --brain
          </code>{" "}
          or{" "}
          <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[12px] text-[var(--color-ink)]">
            aju brains switch
          </code>
          .
        </p>
        <form action={renameBrainAction} className="flex flex-col gap-3">
          <input type="hidden" name="brainId" value={brain.id} />
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
              name
            </span>
            <input
              type="text"
              name="name"
              defaultValue={brain.name}
              required
              maxLength={NAME_MAX_LEN}
              disabled={!canManage}
              className="rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] focus:border-white/20 focus:outline-none disabled:opacity-60"
            />
          </label>
          <div>
            <button
              type="submit"
              disabled={!canManage}
              className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02] disabled:cursor-not-allowed disabled:opacity-50"
            >
              save name
            </button>
          </div>
        </form>
      </section>

      {/* Delete */}
      <section className="flex flex-col gap-4 rounded-xl border border-[var(--color-accent)]/20 bg-[var(--color-panel)]/85 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium text-[var(--color-ink)]">
            Delete brain
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
            danger zone
          </span>
        </div>
        {!canManage ? (
          <p className="text-[13px] leading-6 text-[var(--color-muted)]">
            Only the owner can delete this brain.
          </p>
        ) : (
          <>
            <p className="text-[13px] leading-6 text-[var(--color-muted)]">
              Deleting removes all documents, files, links, and access rows in
              this brain. This cannot be undone. Type the brain name to
              confirm.
            </p>
            <form action={deleteBrainAction} className="flex flex-col gap-3">
              <input type="hidden" name="brainId" value={brain.id} />
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
                  type{" "}
                  <span className="text-[var(--color-ink)]">{brain.name}</span>{" "}
                  to confirm
                </span>
                <input
                  type="text"
                  name="confirm"
                  required
                  autoComplete="off"
                  placeholder={brain.name}
                  className="rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] focus:border-[var(--color-accent)]/50 focus:outline-none"
                />
              </label>
              <div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/50 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
                >
                  delete brain
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-[var(--color-panel)]/50 p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          metadata
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-2 font-mono text-[12px] text-[var(--color-muted)] sm:grid-cols-2">
          <MetaRow k="id" v={brain.id} />
          <MetaRow k="type" v={brain.type} />
          <MetaRow
            k="organization"
            v={organization?.slug ?? "—"}
          />
          <MetaRow k="created" v={brain.createdAt.toISOString()} />
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
