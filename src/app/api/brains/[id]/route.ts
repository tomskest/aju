import { NextRequest, NextResponse } from "next/server";
import type { Prisma as PrismaTenant } from "@prisma/client-tenant";
import { authenticate, isAuthError, type AuthSuccess } from "@/lib/auth";
import { prisma, tenantDbFor } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { getActiveOrganizationId } from "@/lib/auth";
import { cascadeDeleteBrainRows, wipeBrainObjects } from "@/lib/vault";

export const runtime = "nodejs";

const NAME_MAX_LEN = 64;

type RouteContext = { params: Promise<{ id: string }> };
type TenantTx = PrismaTenant.TransactionClient;

type PatchPayload = {
  name?: string;
};

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

async function resolveOrgId(auth: AuthSuccess): Promise<string | null> {
  if (auth.organizationId) return auth.organizationId;
  if (auth.userId) {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { personalOrgId: true },
    });
    if (user?.personalOrgId) return user.personalOrgId;
  }
  return getActiveOrganizationId();
}

/**
 * Resolve a brain by id for the caller, along with the caller's effective
 * role. Access is granted when the caller has a BrainAccess row OR — for
 * `type: "org"` brains only — is a member of the org that owns this tenant
 * DB (control-plane check). Returns null for access denied / missing.
 *
 * Personal brains are owner-private: only callers with an explicit
 * BrainAccess row see them, even when sharing an org membership with the
 * owner.
 *
 * An org-membership-driven view of a `type: "org"` brain surfaces as
 * "editor" so members can read and write without per-brain provisioning.
 */
async function loadAccessibleBrain(
  tx: TenantTx,
  auth: AuthSuccess,
  organizationId: string,
  brainId: string,
) {
  if (!auth.userId && !auth.agentId) return null;

  const brain = await tx.brain.findUnique({
    where: { id: brainId },
    include: { _count: { select: { documents: true, files: true } } },
  });
  if (!brain) return null;

  // Agent principals: look up BrainAccess by agentId. The user-membership
  // fallback does NOT apply to agents — they only see brains explicitly
  // granted to them.
  if (auth.agentId) {
    const access = await tx.brainAccess.findFirst({
      where: { brainId, agentId: auth.agentId },
    });
    if (access) {
      return { brain, role: access.role, hasExplicitAccess: true };
    }
    return null;
  }

  const access = await tx.brainAccess.findUnique({
    where: { brainId_userId: { brainId, userId: auth.userId! } },
  });
  if (access) {
    return { brain, role: access.role, hasExplicitAccess: true };
  }

  // Fall back to an org-level check so members of the brain's org can view
  // org-type brains without a direct BrainAccess row. Personal brains stay
  // private to their owner regardless of shared org membership.
  if (brain.type !== "org") return null;

  const membership = await prisma.organizationMembership.findFirst({
    where: {
      userId: auth.userId!,
      organizationId,
    },
    select: { id: true },
  });
  if (membership) {
    return { brain, role: "editor" as const, hasExplicitAccess: false };
  }

  return null;
}

/**
 * GET /api/brains/[id]
 *
 * Brain detail: doc count, file count, caller role, timestamps. Callers with
 * no BrainAccess row but a matching org membership see a viewer-level view.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const auth = await authenticate(req);
  if (isAuthError(auth)) return auth;

  const organizationId = await resolveOrgId(auth);
  if (!organizationId) return notFound();

  const { id } = await ctx.params;
  return withTenant(
    { organizationId, userId: auth.userId, agentId: auth.agentId },
    async ({ tx }) => {
      const loaded = await loadAccessibleBrain(tx, auth, organizationId, id);
      if (!loaded) return notFound();

      const { brain, role } = loaded;
      return NextResponse.json({
        brain: {
          id: brain.id,
          name: brain.name,
          type: brain.type,
          organizationId,
          documentCount: brain._count.documents,
          fileCount: brain._count.files,
          createdAt: brain.createdAt.toISOString(),
          role,
        },
      });
    },
  );
}

/**
 * PATCH /api/brains/[id]
 *
 * Rename a brain. Owner-only.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const auth = await authenticate(req);
  if (isAuthError(auth)) return auth;

  const organizationId = await resolveOrgId(auth);
  if (!organizationId) return notFound();

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as PatchPayload;
  const wantsRename = typeof body.name === "string" && body.name.trim() !== "";
  if (!wantsRename) {
    return NextResponse.json(
      { error: "no changes supplied" },
      { status: 400 },
    );
  }

  const newName = (body.name as string).trim();
  if (newName.length > NAME_MAX_LEN) {
    return NextResponse.json(
      { error: `name must be ${NAME_MAX_LEN} characters or fewer` },
      { status: 400 },
    );
  }

  return withTenant(
    { organizationId, userId: auth.userId, agentId: auth.agentId },
    async ({ tx }) => {
      const loaded = await loadAccessibleBrain(tx, auth, organizationId, id);
      if (!loaded) return notFound();
      if (loaded.role !== "owner") return forbidden();

      const updated = await tx.brain.update({
        where: { id },
        data: { name: newName },
        select: { id: true, name: true, type: true },
      });

      return NextResponse.json({ brain: updated });
    },
  );
}

/**
 * DELETE /api/brains/[id]
 *
 * Owner-only. Refuses the delete when this is the caller's only owned brain
 * so they never end up without anywhere to write. Schema-level cascades wipe
 * the brain's documents, links, files, and access rows; we additionally wipe
 * the brain's objects from R2 before dropping DB rows. R2 failures are
 * non-fatal and surfaced as warnings so the DB never ends up pointing at
 * dead storage.
 *
 * Two-phase implementation: wipe S3 BEFORE opening the cascade transaction.
 * Tenant DBs run with `connection_limit=1`; if both phases shared one
 * `withTenant({unscoped:true})` wrapper, the outer transaction would hold
 * the only connection while `vaultFile.findMany` waited 10s for a second
 * one and timed out with P2024. Splitting the phases keeps each query on a
 * connection it can actually hold.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const auth = await authenticate(req);
  if (isAuthError(auth)) return auth;

  const organizationId = await resolveOrgId(auth);
  if (!organizationId) return notFound();

  const { id } = await ctx.params;

  const precheck = await withTenant(
    { organizationId, userId: auth.userId, agentId: auth.agentId },
    async ({ tx }) => {
      const loaded = await loadAccessibleBrain(tx, auth, organizationId, id);
      if (!loaded) return { kind: "not_found" as const };
      if (loaded.role !== "owner") return { kind: "forbidden" as const };

      // Last-brain guard: refuse to delete the caller's only owned brain so a
      // fresh account doesn't accidentally wipe their default vault. For agent
      // principals the guard uses agentId; a human can always revoke a brain
      // they own even if it's their last, because they still have the org.
      const ownerWhere = auth.agentId
        ? { agentId: auth.agentId, role: "owner" }
        : { userId: auth.userId, role: "owner" };
      const ownedCount = await tx.brainAccess.count({ where: ownerWhere });
      if (ownedCount <= 1) {
        return { kind: "last_brain" as const };
      }
      return { kind: "ok" as const };
    },
  );

  if (precheck.kind === "not_found") return notFound();
  if (precheck.kind === "forbidden") return forbidden();
  if (precheck.kind === "last_brain") {
    return NextResponse.json(
      {
        error: "last_brain",
        message:
          "you can't delete your only owned brain — create another one first.",
      },
      { status: 409 },
    );
  }

  // Phase 1: wipe S3 outside any transaction. `wipeBrainObjects` reads
  // `vaultFile.s3Key` once and then issues a bulk S3 deleteMany — no DB
  // transaction needed, and crucially no contention with phase 2's
  // connection.
  const tenant = await tenantDbFor(organizationId);
  const wipe = await wipeBrainObjects(tenant, organizationId, id);

  // Phase 2: cascade-delete DB rows inside a single transaction with RLS
  // bypass. Bumped timeout because brains with hundreds of change-log rows
  // routinely exceed Prisma's 5s default and surface as P2028.
  await withTenant(
    {
      organizationId,
      userId: auth.userId,
      agentId: auth.agentId,
      unscoped: true,
      timeoutMs: 120_000,
    },
    async ({ tx }) => cascadeDeleteBrainRows(tx, id),
  );

  return NextResponse.json({
    ok: true,
    r2ObjectsDeleted: wipe.deleted,
    r2Warnings: wipe.warnings,
  });
}
