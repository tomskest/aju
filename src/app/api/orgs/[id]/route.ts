import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, tenantDbFor } from "@/lib/db";
import { deleteOrganizationWithStorage } from "@/lib/vault";
import { canManageOrg, canManageMembers, slugify } from "@/lib/tenant";
import { authedOrgRoute } from "@/lib/route-helpers";
import { nameSchema, validateBody } from "@/lib/validators";

export const runtime = "nodejs";

const SLUG_RETRY_LIMIT = 3;

const patchOrgSchema = z
  .object({
    name: nameSchema.optional(),
    autoAcceptDomainRequests: z.boolean().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.autoAcceptDomainRequests !== undefined,
    { message: "no_changes_supplied" },
  );

/** 6-char base36 random suffix for slug uniqueness — mirrors verify/route.ts. */
function shortId(): string {
  let s = "";
  while (s.length < 6) {
    s += Math.random().toString(36).slice(2);
  }
  return s.slice(0, 6);
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
export const GET = authedOrgRoute<{ id: string }>(
  async ({ organizationId, role }) => {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        isPersonal: true,
        planTier: true,
        autoAcceptDomainRequests: true,
        _count: { select: { memberships: true } },
      },
    });
    if (!org) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const brainCount = await tenantBrainCount(org.id);
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      isPersonal: org.isPersonal,
      planTier: org.planTier,
      autoAcceptDomainRequests: org.autoAcceptDomainRequests,
      memberCount: org._count.memberships,
      brainCount,
      role,
    };
  },
  { orgIdParam: "id" },
);

/**
 * PATCH /api/orgs/[id]
 *
 * Rename the org and/or toggle `autoAcceptDomainRequests`. Rename is
 * owner-only (via `canManageOrg`); the domain-request flag is editable by
 * any member who can manage members (owner + admin) — so we set the helper's
 * gate to admin and check the rename gate inline.
 */
export const PATCH = authedOrgRoute<{ id: string }>(
  async ({ req, organizationId, role }) => {
    const validation = await validateBody(req, patchOrgSchema);
    if (!validation.ok) return validation.response;
    const { name: newName, autoAcceptDomainRequests } = validation.value;

    const wantsRename = newName !== undefined;
    const wantsFlagChange = autoAcceptDomainRequests !== undefined;

    // Rename is owner-only; flag change is owner+admin (already gated by minRole).
    if (wantsRename && !canManageOrg(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (wantsFlagChange && !canManageMembers(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updates: Prisma.OrganizationUpdateInput = {};
    if (wantsFlagChange) {
      updates.autoAcceptDomainRequests = autoAcceptDomainRequests;
    }
    if (wantsRename) {
      updates.name = newName;
    }

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
            where: { id: organizationId },
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
        where: { id: organizationId },
        data: updates,
        select: {
          id: true,
          name: true,
          slug: true,
          autoAcceptDomainRequests: true,
        },
      });
    }

    return {
      org: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        autoAcceptDomainRequests: updated.autoAcceptDomainRequests,
      },
    };
  },
  { orgIdParam: "id", minRole: "admin" },
);

/**
 * DELETE /api/orgs/[id]?confirm=<slug>
 *
 * Owner-only destructive op. Requires `confirm` to match the current slug
 * (typed-name safety). Personal orgs can't be deleted. Any remaining brains
 * block the delete with a 409 — the caller must remove or move them first.
 */
export const DELETE = authedOrgRoute<{ id: string }>(
  async ({ req, organizationId }) => {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, slug: true, isPersonal: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (org.isPersonal) {
      return NextResponse.json(
        { error: "cannot delete personal org" },
        { status: 400 },
      );
    }

    const confirm = req.nextUrl.searchParams.get("confirm");
    if (!confirm || confirm !== org.slug) {
      return NextResponse.json(
        { error: "confirm query param must match org slug" },
        { status: 400 },
      );
    }

    // Manually gate on brains instead of silently wiping them. Callers must
    // remove or move brains first. Brain rows live in the tenant DB now.
    const brainCount = await tenantBrainCount(organizationId);
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
    await deleteOrganizationWithStorage(organizationId);

    return { ok: true };
  },
  { orgIdParam: "id", minRole: "owner" },
);
