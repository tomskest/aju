import { NextRequest, NextResponse } from "next/server";
import type { Prisma as PrismaTenant } from "@prisma/client-tenant";
import { z } from "zod";
import { authenticate, isAuthError, type AuthSuccess } from "@/lib/auth";
import { requireScope } from "@/lib/route-helpers";
import { prisma } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { getActiveOrganizationId } from "@/lib/auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
type TenantTx = PrismaTenant.TransactionClient;

const BRAIN_SETTINGS_DEFAULTS = {
  validationHalfLifeDays: 180,
  rankWeightValidated: 0.1,
  rankWeightStale: -0.05,
  rankWeightHuman: 0.05,
} as const;

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
 * Reuse the access-resolution shape from /api/brains/[id]/route.ts —
 * personal brain requires explicit BrainAccess; org brains accept org
 * membership. Returning the role lets the PATCH handler enforce
 * owner-only writes.
 */
async function loadAccessibleBrain(
  tx: TenantTx,
  auth: AuthSuccess,
  organizationId: string,
  brainId: string,
) {
  if (!auth.userId && !auth.agentId) return null;

  const brain = await tx.brain.findUnique({ where: { id: brainId } });
  if (!brain) return null;

  if (auth.agentId) {
    const access = await tx.brainAccess.findFirst({
      where: { brainId, agentId: auth.agentId },
    });
    if (access) return { brain, role: access.role };
    return null;
  }

  const access = await tx.brainAccess.findUnique({
    where: { brainId_userId: { brainId, userId: auth.userId! } },
  });
  if (access) return { brain, role: access.role };

  if (brain.type !== "org") return null;

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: auth.userId!, organizationId },
    select: { id: true },
  });
  if (membership) return { brain, role: "editor" as const };

  return null;
}

/**
 * Auto-create BrainSettings on first read. Defaults match
 * BRAIN_SETTINGS_DEFAULTS above and the schema's @default(...) — kept in
 * one place so a future tweak only requires updating the constants.
 */
async function ensureSettings(tx: TenantTx, brainId: string) {
  const existing = await tx.brainSettings.findUnique({
    where: { brainId },
  });
  if (existing) return existing;

  return tx.brainSettings.create({
    data: { brainId, ...BRAIN_SETTINGS_DEFAULTS },
  });
}

/**
 * GET /api/brains/[id]/settings
 *
 * Returns the brain's settings, auto-creating with defaults on first
 * request. Any caller with read access to the brain may read settings —
 * mirrors how doc list / search behave.
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

      const settings = await ensureSettings(tx, id);
      return NextResponse.json({
        brain: { id: loaded.brain.id, name: loaded.brain.name, type: loaded.brain.type },
        role: loaded.role,
        settings: {
          validationHalfLifeDays: settings.validationHalfLifeDays,
          rankWeightValidated: settings.rankWeightValidated,
          rankWeightStale: settings.rankWeightStale,
          rankWeightHuman: settings.rankWeightHuman,
          updatedAt: settings.updatedAt.toISOString(),
        },
      });
    },
  );
}

const patchSchema = z.object({
  validationHalfLifeDays: z.number().int().min(1).max(3650).optional(),
  rankWeightValidated: z.number().min(-1).max(1).optional(),
  rankWeightStale: z.number().min(-1).max(1).optional(),
  rankWeightHuman: z.number().min(-1).max(1).optional(),
});

/**
 * PATCH /api/brains/[id]/settings
 *
 * Owner-only. The "admin" credential scope is required (matches PATCH on
 * the brain row itself); accidental edits via a "write"-scoped key
 * shouldn't change retrieval behavior across the brain.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const auth = await authenticate(req);
  if (isAuthError(auth)) return auth;

  const scopeDenied = requireScope(auth, "admin");
  if (scopeDenied) return scopeDenied;

  const organizationId = await resolveOrgId(auth);
  if (!organizationId) return notFound();

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const update = parsed.data;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no_changes_supplied" }, { status: 400 });
  }

  return withTenant(
    { organizationId, userId: auth.userId, agentId: auth.agentId },
    async ({ tx }) => {
      const loaded = await loadAccessibleBrain(tx, auth, organizationId, id);
      if (!loaded) return notFound();
      if (loaded.role !== "owner") return forbidden();

      const settings = await tx.brainSettings.upsert({
        where: { brainId: id },
        update,
        create: {
          brainId: id,
          ...BRAIN_SETTINGS_DEFAULTS,
          ...update,
        },
      });

      return NextResponse.json({
        settings: {
          validationHalfLifeDays: settings.validationHalfLifeDays,
          rankWeightValidated: settings.rankWeightValidated,
          rankWeightStale: settings.rankWeightStale,
          rankWeightHuman: settings.rankWeightHuman,
          updatedAt: settings.updatedAt.toISOString(),
        },
      });
    },
  );
}
