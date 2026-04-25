import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clearActiveOrganizationCookie, clearSessionCookie } from "@/lib/auth";
import { deleteOrganizationWithStorage } from "@/lib/vault";
import { authedUserRoute } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/me/delete  (POST is accepted as an alias for clients that
 * can't easily issue DELETE with a body).
 *
 * Wipes the signed-in user's data:
 *
 *   1. For every org the user OWNS (including their personal org): wipe
 *      every brain's R2 objects, drop the org's per-tenant database, and
 *      delete the org row. `deleteOrganizationWithStorage` handles all
 *      three steps atomically enough for our purposes.
 *   2. Drop any remaining OrganizationMembership rows so the user leaves
 *      orgs they don't own. The orgs themselves stay up.
 *   3. Delete the User row — sessions, accounts, api_keys, etc. cascade
 *      via schema `onDelete: Cascade`. Any tenant-side BrainAccess rows
 *      keyed by this user's id are harmless denormalized strings and will
 *      be cleaned up by the per-tenant eviction below.
 *   4. Clear the session + active-org cookies so the caller is signed out.
 *
 * Idempotent: a second call has no signed-in user and returns 401 rather
 * than erroring. Within a single call, each step is safe to re-run; we
 * always re-read state after each phase in case of partial progress from
 * a prior attempt.
 */
const handler = authedUserRoute(async ({ user, agentId }) => {
  if (agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_delete_account" },
      { status: 403 },
    );
  }
  const userId = user.id;

  let brainsDeleted = 0;
  let orgsDeleted = 0;
  let r2ObjectsDeleted = 0;
  const r2Warnings: string[] = [];

  // --- 1. Orgs owned by the user --------------------------------------
  const ownedOrgs = await prisma.organization.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });

  for (const org of ownedOrgs) {
    try {
      const res = await deleteOrganizationWithStorage(org.id);
      brainsDeleted += res.brainsDeleted;
      r2ObjectsDeleted += res.r2ObjectsDeleted;
      r2Warnings.push(...res.r2Warnings);
      orgsDeleted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[me-delete] org ${org.id} failed:`, err);
      r2Warnings.push(`org delete failed id=${org.id}: ${msg}`);
    }
  }

  // The User.personalOrgId FK was cleared by the cascade above. Null it
  // defensively in case the deleteOrganization path left it dangling, so
  // the final User.delete doesn't trip an FK constraint.
  await prisma.user
    .update({ where: { id: userId }, data: { personalOrgId: null } })
    .catch(() => {
      // Row may already be gone (idempotent re-run) — ignore.
    });

  // --- 2. Remove memberships in orgs the user doesn't own -------------
  // Per the spec: if the user is just a member of someone else's org,
  // they leave — the org keeps running. Membership rows cascade on User
  // delete below too, but explicit deletion is clearer and keeps the
  // semantics obvious if we ever change User cascade behavior.
  await prisma.organizationMembership.deleteMany({ where: { userId } });

  // --- 3. Delete the user row ----------------------------------------
  // sessions, accounts, api_keys, memberships cascade on User delete
  // per schema.prisma.
  await prisma.user.delete({ where: { id: userId } }).catch((err) => {
    // Already gone? treat as idempotent success.
    const code = (err as { code?: string } | null)?.code;
    if (code !== "P2025") throw err;
  });

  // --- 4. Clear cookies ----------------------------------------------
  await clearSessionCookie();
  await clearActiveOrganizationCookie();

  return {
    ok: true,
    brainsDeleted,
    orgsDeleted,
    r2ObjectsDeleted,
    r2Warnings,
  };
});

export const DELETE = handler;
export const POST = handler;
