import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma, tenantDbFor } from "@/lib/db";
import { deleteOrganizationWithStorage } from "@/lib/vault";
import { currentAuth } from "@/lib/auth";
import {
  canManageOrg,
  canManageMembers,
  slugify,
  type OrgRole,
} from "@/lib/tenant";

export const runtime = "nodejs";

const SLUG_RETRY_LIMIT = 3;

/** 6-char base36 random suffix for slug uniqueness — mirrors verify/route.ts. */
function shortId(): string {
  let s = "";
  while (s.length < 6) {
    s += Math.random().toString(36).slice(2);
  }
  return s.slice(0, 6);
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Look up an org the caller is a member of. Returns the org shape needed by
 * the routes plus the caller's role; returns `null` if the user is not a
 * member (so we can respond with 404 to avoid leaking existence).
 */
async function loadMembership(userId: string, orgId: string) {
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, organizationId: orgId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          isPersonal: true,
          planTier: true,
          autoAcceptDomainRequests: true,
          _count: {
            select: {
              memberships: true,
            },
          },
        },
      },
    },
  });
  if (!membership) return null;
  return {
    role: membership.role as OrgRole,
    org: membership.organization,
  };
}

/**
 * Count brains in the org's per-tenant DB. Brain rows live in the tenant
 * plane now — we query the tenant client rather than joining through
 * Organization.brains (which no longer exists).
 *
 * If the tenant DB is unreachable (still provisioning, suspended, archived)
 * we return 0 instead of 500ing the whole GET — the response still tells
 * the caller about the org, it just understates brain count momentarily.
 */
async function tenantBrainCount(orgId: string): Promise<number> {
  try {
    const tenant = await tenantDbFor(orgId);
    return await tenant.brain.count();
  } catch (err) {
    console.error(`[orgs/${orgId}] brain count failed:`, err);
    return 0;
  }
}

/**
 * GET /api/orgs/[id]
 *
 * Return org detail including member and brain counts. 404s if the caller
 * is not a member — we don't disclose whether an org exists.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_orgs" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const { id } = await ctx.params;
  const loaded = await loadMembership(user.id, id);
  if (!loaded) return notFound();

  const { org, role } = loaded;
  const brainCount = await tenantBrainCount(org.id);
  return NextResponse.json({
    id: org.id,
    name: org.name,
    slug: org.slug,
    isPersonal: org.isPersonal,
    planTier: org.planTier,
    autoAcceptDomainRequests: org.autoAcceptDomainRequests,
    memberCount: org._count.memberships,
    brainCount,
    role,
  });
}

type PatchPayload = {
  name?: string;
  autoAcceptDomainRequests?: boolean;
};

/**
 * PATCH /api/orgs/[id]
 *
 * Rename the org and/or toggle `autoAcceptDomainRequests`. Rename is
 * owner-only (via `canManageOrg`); the domain-request flag is editable by
 * any member who can manage members (owner + admin).
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_orgs" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const { id } = await ctx.params;
  const loaded = await loadMembership(user.id, id);
  if (!loaded) return notFound();

  const body = (await req.json().catch(() => ({}))) as PatchPayload;

  const wantsRename = typeof body.name === "string" && body.name.trim() !== "";
  const wantsFlagChange = typeof body.autoAcceptDomainRequests === "boolean";

  if (!wantsRename && !wantsFlagChange) {
    return NextResponse.json(
      { error: "no changes supplied" },
      { status: 400 },
    );
  }

  // Rename is a higher bar than flipping the auto-accept flag.
  if (wantsRename && !canManageOrg(loaded.role)) return forbidden();
  if (wantsFlagChange && !canManageMembers(loaded.role)) return forbidden();

  const updates: Prisma.OrganizationUpdateInput = {};
  if (wantsFlagChange) {
    updates.autoAcceptDomainRequests = body.autoAcceptDomainRequests;
  }

  let newName: string | null = null;
  if (wantsRename) {
    newName = (body.name as string).trim();
    if (newName.length > 120) {
      return NextResponse.json({ error: "name too long" }, { status: 400 });
    }
    updates.name = newName;
  }

  // If the name changed, we regenerate the slug with the same retry loop
  // used elsewhere. We run the update inside a loop so we can swap out the
  // candidate slug on collision.
  let updated: {
    id: string;
    name: string;
    slug: string;
    autoAcceptDomainRequests: boolean;
  } | null = null;

  if (wantsRename && newName) {
    const baseSlug = slugify(newName) || "org";
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < SLUG_RETRY_LIMIT; attempt++) {
      const candidate = `${baseSlug}-${shortId()}`;
      try {
        updated = await prisma.organization.update({
          where: { id },
          data: { ...updates, slug: candidate },
          select: {
            id: true,
            name: true,
            slug: true,
            autoAcceptDomainRequests: true,
          },
        });
        break;
      } catch (err) {
        lastErr = err;
        const code = (err as Prisma.PrismaClientKnownRequestError | null)?.code;
        if (code !== "P2002") throw err;
      }
    }
    if (!updated) {
      console.error("Org slug allocation failed on rename:", lastErr);
      return NextResponse.json(
        { error: "could not allocate slug" },
        { status: 500 },
      );
    }
  } else {
    updated = await prisma.organization.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        name: true,
        slug: true,
        autoAcceptDomainRequests: true,
      },
    });
  }

  return NextResponse.json({
    org: {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      autoAcceptDomainRequests: updated.autoAcceptDomainRequests,
    },
  });
}

/**
 * DELETE /api/orgs/[id]?confirm=<slug>
 *
 * Owner-only destructive op. Requires `confirm` to match the current slug
 * (typed-name safety). Personal orgs can't be deleted. Any remaining brains
 * block the delete with a 409 — the caller must remove or move them first.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_orgs" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const { id } = await ctx.params;
  const loaded = await loadMembership(user.id, id);
  if (!loaded) return notFound();

  if (!canManageOrg(loaded.role)) return forbidden();

  if (loaded.org.isPersonal) {
    return NextResponse.json(
      { error: "cannot delete personal org" },
      { status: 400 },
    );
  }

  const confirm = req.nextUrl.searchParams.get("confirm");
  if (!confirm || confirm !== loaded.org.slug) {
    return NextResponse.json(
      { error: "confirm query param must match org slug" },
      { status: 400 },
    );
  }

  // Manually gate on brains instead of silently wiping them. Callers must
  // remove or move brains first. Brain rows live in the tenant DB now.
  const brainCount = await tenantBrainCount(id);
  if (brainCount > 0) {
    return NextResponse.json(
      {
        error: "org has brains; remove or move them before deleting",
        brainCount,
      },
      { status: 409 },
    );
  }

  // Even with brainCount === 0 there can still be tenant infrastructure
  // (DB, role, stray files) to tear down. deleteOrganizationWithStorage
  // handles R2 wipe + destroyTenant + control-plane org delete.
  await deleteOrganizationWithStorage(id);

  return NextResponse.json({ ok: true });
}
