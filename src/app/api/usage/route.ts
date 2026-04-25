import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantDbFor } from "@/lib/db";
import { currentAuth } from "@/lib/auth";
import { limitsFor } from "@/lib/billing";

export const runtime = "nodejs";

/**
 * GET /api/usage
 *
 * Returns a point-in-time snapshot of the caller's consumption. Counts are
 * derived from existing tables (no UsageEvent table yet); rate-limited
 * counters (searches, embedding tokens) are absent from the response because
 * we can't measure them without a time-series feed. Their caps still surface
 * under `limits` so the client knows what the plan advertises.
 *
 * Post-split: document/file/brain counts live in per-tenant DBs. We iterate
 * the user's memberships, sum counts across every tenant, and return a
 * cross-tenant total — preserving the existing response shape.
 */
export async function GET(req: NextRequest) {
  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { user } = auth;

  const userId = user.id;
  const planTier = user.planTier ?? "free";
  const grandfathered = user.grandfatheredAt !== null;

  // Control-plane counts + cohort placement run in parallel and don't depend
  // on tenant access.
  const [apiKeysActive, placement, memberships] = await Promise.all([
    prisma.apiKey.count({
      where: { userId, revokedAt: null },
    }),
    user.grandfatheredAt
      ? prisma.user.count({
          where: {
            grandfatheredAt: { not: null, lte: user.grandfatheredAt },
          },
        })
      : Promise.resolve<number | null>(null),
    prisma.organizationMembership.findMany({
      where: { userId },
      select: { organizationId: true },
    }),
  ]);

  // Per-tenant tallies. Each org has its own DB; we sum the user's brain
  // access, document count, file count, and file byte size across all of
  // them. A tenant that's unreachable (e.g. still provisioning) is skipped
  // so usage doesn't 500 the whole response.
  let documents = 0;
  let files = 0;
  let storageBytes = 0;
  let brains = 0;

  for (const m of memberships) {
    let tenant;
    try {
      tenant = await tenantDbFor(m.organizationId);
    } catch (err) {
      console.error(
        `[usage] skipping org ${m.organizationId}: tenant unavailable`,
        err,
      );
      continue;
    }

    const [docCount, fileCount, fileBytesAgg, brainCount] = await Promise.all([
      tenant.vaultDocument.count({
        where: { brain: { access: { some: { userId } } } },
      }),
      tenant.vaultFile.count({
        where: { brain: { access: { some: { userId } } } },
      }),
      tenant.vaultFile.aggregate({
        where: { brain: { access: { some: { userId } } } },
        _sum: { sizeBytes: true },
      }),
      tenant.brainAccess.count({ where: { userId } }),
    ]);

    documents += docCount;
    files += fileCount;
    storageBytes += fileBytesAgg._sum.sizeBytes ?? 0;
    brains += brainCount;
  }

  const limits = limitsFor(planTier);

  return NextResponse.json({
    usage: {
      documents,
      files,
      storageBytes,
      brains,
      apiKeysActive,
      grandfathered,
      placement: placement ?? undefined,
      planTier,
      limits,
    },
  });
}
