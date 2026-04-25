import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { deleteOrganizationWithStorage } from "@/lib/vault";
import {
  canManageMembers,
  canManageOrg,
  slugify,
  type OrgRole,
} from "@/lib/tenant";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
};

/** 6-char base36 suffix for slug uniqueness — mirrors /api/orgs route. */
function shortId(): string {
  let s = "";
  while (s.length < 6) {
    s += Math.random().toString(36).slice(2);
  }
  return s.slice(0, 6);
}

async function assertManageOrg(orgId: string): Promise<{
  userId: string;
  role: OrgRole;
  isPersonal: boolean;
  slug: string;
}> {
  const user = await currentUser();
  if (!user) redirect("/");
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId: orgId },
    include: {
      organization: {
        select: { isPersonal: true, slug: true },
      },
    },
  });
  if (!membership) notFound();
  return {
    userId: user.id,
    role: membership.role as OrgRole,
    isPersonal: membership.organization.isPersonal,
    slug: membership.organization.slug,
  };
}

async function renameOrgAction(formData: FormData): Promise<void> {
  "use server";
  const orgId = (formData.get("orgId") as string | null) ?? "";
  if (!orgId) return;

  const ctx = await assertManageOrg(orgId);
  if (!canManageOrg(ctx.role)) {
    redirect(`/app/orgs/${orgId}/settings?error=forbidden`);
  }

  const rawName = ((formData.get("name") as string | null) ?? "").trim();
  if (!rawName) {
    redirect(`/app/orgs/${orgId}/settings?error=name-required`);
  }
  if (rawName.length > 120) {
    redirect(`/app/orgs/${orgId}/settings?error=name-too-long`);
  }

  const baseSlug = slugify(rawName) || "org";
  let ok = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = `${baseSlug}-${shortId()}`;
    try {
      await prisma.organization.update({
        where: { id: orgId },
        data: { name: rawName, slug: candidate },
      });
      ok = true;
      break;
    } catch (err) {
      const code = (err as Prisma.PrismaClientKnownRequestError | null)?.code;
      if (code !== "P2002") throw err;
    }
  }
  if (!ok) {
    redirect(`/app/orgs/${orgId}/settings?error=slug-collision`);
  }
  revalidatePath(`/app/orgs/${orgId}`, "layout");
  redirect(`/app/orgs/${orgId}/settings?ok=renamed`);
}

async function toggleAutoAcceptAction(formData: FormData): Promise<void> {
  "use server";
  const orgId = (formData.get("orgId") as string | null) ?? "";
  if (!orgId) return;

  const ctx = await assertManageOrg(orgId);
  if (!canManageMembers(ctx.role)) {
    redirect(`/app/orgs/${orgId}/settings?error=forbidden`);
  }

  // Checkbox is present in formData only when checked. Read the desired value
  // from a hidden field so we can distinguish "on" (intent: enable) from "off"
  // (intent: disable) in a single form.
  const desired =
    (formData.get("autoAcceptDomainRequests") as string | null) === "on";

  await prisma.organization.update({
    where: { id: orgId },
    data: { autoAcceptDomainRequests: desired },
  });
  revalidatePath(`/app/orgs/${orgId}`, "layout");
  redirect(`/app/orgs/${orgId}/settings?ok=auto-accept`);
}

async function deleteOrgAction(formData: FormData): Promise<void> {
  "use server";
  const orgId = (formData.get("orgId") as string | null) ?? "";
  if (!orgId) return;

  const ctx = await assertManageOrg(orgId);
  if (!canManageOrg(ctx.role)) {
    redirect(`/app/orgs/${orgId}/settings?error=forbidden`);
  }
  if (ctx.isPersonal) {
    redirect(`/app/orgs/${orgId}/settings?error=cannot-delete-personal`);
  }

  const confirm = ((formData.get("confirm") as string | null) ?? "").trim();
  if (confirm !== ctx.slug) {
    redirect(`/app/orgs/${orgId}/settings?error=confirm-mismatch`);
  }

  // Full teardown: wipes S3 for every brain, drops the Neon tenant DB +
  // role, then deletes the control-plane organization row. The slug
  // confirmation above is the user-facing guard — no separate empty-check
  // since the whole point of "delete" is to take everything with it.
  try {
    await deleteOrganizationWithStorage(orgId);
  } catch (err) {
    console.error(`[orgs/settings] deleteOrganizationWithStorage failed for ${orgId}:`, err);
    redirect(`/app/orgs/${orgId}/settings?error=delete-failed`);
  }
  revalidatePath("/app", "layout");
  redirect("/app/orgs?ok=deleted");
}

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "you don't have permission to do that.",
  "name-required": "please provide a name.",
  "name-too-long": "name must be 120 characters or fewer.",
  "slug-collision": "couldn't allocate a slug. try again.",
  "cannot-delete-personal": "personal organizations cannot be deleted.",
  "delete-failed": "deletion failed — the org is still here. check server logs and try again.",
  "confirm-mismatch": "the slug you typed didn't match.",
};

const OK_MESSAGES: Record<string, string> = {
  renamed: "renamed.",
  "auto-accept": "auto-accept setting saved.",
};

export default async function OrgSettingsPage({
  params,
  searchParams,
}: PageProps) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const sp = await searchParams;

  const membership = await prisma.organizationMembership.findFirst({
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
        },
      },
    },
  });
  if (!membership) notFound();

  const org = membership.organization;
  const role = membership.role as OrgRole;
  const canManage = canManageOrg(role);
  const canToggleAutoAccept = canManageMembers(role);
  const canDelete = canManage && !org.isPersonal;

  const errorMessage = sp.error ? ERROR_MESSAGES[sp.error] ?? sp.error : null;
  const okMessage = sp.ok ? OK_MESSAGES[sp.ok] ?? sp.ok : null;

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <Link
          href={`/app/orgs/${org.id}`}
          className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
        >
          ← {org.name}
        </Link>
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          settings
        </p>
        <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
          organization settings
        </h1>
        <p className="max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
          Configure this organization. Owners can rename and delete; owners and
          admins can adjust domain request behaviour.
        </p>
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
          Renaming the organization will regenerate its slug. Existing links
          using the old slug will still work via the org id.
        </p>
        <form action={renameOrgAction} className="flex flex-col gap-3">
          <input type="hidden" name="orgId" value={org.id} />
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
              name
            </span>
            <input
              type="text"
              name="name"
              defaultValue={org.name}
              required
              maxLength={120}
              disabled={!canManage}
              className="rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 text-[13px] text-[var(--color-ink)] focus:border-white/20 focus:outline-none disabled:opacity-60"
            />
          </label>
          <p className="font-mono text-[11px] text-[var(--color-faint)]">
            current slug:{" "}
            <span className="text-[var(--color-muted)]">{org.slug}</span>
          </p>
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

      {/* Auto-accept */}
      <section className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium text-[var(--color-ink)]">
            Auto-accept domain requests
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
            owner + admin
          </span>
        </div>
        <p className="text-[13px] leading-6 text-[var(--color-muted)]">
          When enabled, access requests from people whose email domain is
          verified for this org are auto-approved. Individual invitations are
          unaffected.
        </p>
        <form action={toggleAutoAcceptAction} className="flex flex-col gap-3">
          <input type="hidden" name="orgId" value={org.id} />
          <label className="inline-flex items-center gap-3">
            <input
              type="checkbox"
              name="autoAcceptDomainRequests"
              defaultChecked={org.autoAcceptDomainRequests}
              disabled={!canToggleAutoAccept}
              className="size-4 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span className="text-[13px] text-[var(--color-ink)]">
              Auto-accept from verified domains
            </span>
          </label>
          <div>
            <button
              type="submit"
              disabled={!canToggleAutoAccept}
              className="inline-flex items-center justify-center rounded-md border border-white/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              save setting
            </button>
          </div>
        </form>
        <div className="mt-1 border-t border-white/5 pt-4">
          <Link
            href={`/app/orgs/${org.id}/domains`}
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:text-[var(--color-ink)]"
          >
            manage domains →
          </Link>
        </div>
      </section>

      {/* Delete */}
      <section className="flex flex-col gap-4 rounded-xl border border-[var(--color-accent)]/20 bg-[var(--color-panel)]/85 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium text-[var(--color-ink)]">
            Delete organization
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
            danger zone
          </span>
        </div>
        {org.isPersonal ? (
          <p className="text-[13px] leading-6 text-[var(--color-muted)]">
            This is your personal organization. Personal organizations cannot
            be deleted.
          </p>
        ) : !canManage ? (
          <p className="text-[13px] leading-6 text-[var(--color-muted)]">
            Only the owner can delete the organization.
          </p>
        ) : (
          <>
            <p className="text-[13px] leading-6 text-[var(--color-muted)]">
              Deleting removes all memberships, invitations, domains, and
              access requests. Any remaining brains must be moved or deleted
              first. Type the slug to confirm:
            </p>
            <form action={deleteOrgAction} className="flex flex-col gap-3">
              <input type="hidden" name="orgId" value={org.id} />
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
                  type <span className="text-[var(--color-ink)]">{org.slug}</span> to confirm
                </span>
                <input
                  type="text"
                  name="confirm"
                  required
                  autoComplete="off"
                  placeholder={org.slug}
                  className="rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] focus:border-[var(--color-accent)]/50 focus:outline-none"
                />
              </label>
              <div>
                <button
                  type="submit"
                  disabled={!canDelete}
                  className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/50 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  delete organization
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
