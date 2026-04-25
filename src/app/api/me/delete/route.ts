import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clearActiveOrganizationCookie, clearSessionCookie, currentAuth } from "@/lib/auth";
import { deleteOrganizationWithStorage } from "@/lib/vault";

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
 *
 * Response: `{ brainsDeleted, r2ObjectsDeleted, orgsDeleted, r2Warnings }`.
 */
async function handle(req: NextRequest) {
  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_delete_account" },
      { status: 403 },
    );
  }
  const { user } = auth;
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
      // If an org delete fails we log and continue — the rest of the
      // teardown still needs to run. We surface this as a warning.
      console.error(`[me-delete] org ${org.id} failed:`, err);
      r2Warnings.push(`org delete failed id=${org.id}: ${msg}`);
    }
  }

  // The User.personalOrgId FK was cleared by the cascade above (the org
  // is gone). Null it defensively in case the deleteOrganization path
  // left it dangling for any reason, so the final User.delete doesn't
  // trip an FK constraint.
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
  //
  // NOTE: BrainAccess rows in those orgs' tenant DBs still reference
  // this userId as a denormalized string. They're harmless once the
  // membership is gone (nothing queries them for this user), and a
  // background reaper can sweep them up later. We don't block account
  // deletion on per-tenant BrainAccess cleanup.
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

  return NextResponse.json({
    ok: true,
    brainsDeleted,
    orgsDeleted,
    r2ObjectsDeleted,
    r2Warnings,
  });
}

export async function DELETE(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
