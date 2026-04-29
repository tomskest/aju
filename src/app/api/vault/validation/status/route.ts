import { NextResponse } from "next/server";
import { authedTenantRoute } from "@/lib/route-helpers";
import { resolveBrain, isBrainError } from "@/lib/vault";

// GET /api/vault/validation/status
//
//   ?path=<docPath>     → single-doc validation block + recent log entries
//   (omit path)         → brain-wide breakdown for the document header bar
//
// Returns the same `validation` block shape that POST /api/vault/validate
// returns, so the UI can use a single VaultDocValidation type.

export const GET = authedTenantRoute(async ({ req, tx, principal }) => {
  const brain = await resolveBrain(tx, req, principal);
  if (isBrainError(brain)) return brain;

  const path = req.nextUrl.searchParams.get("path");

  if (path) {
    const doc = await tx.vaultDocument.findFirst({
      where: { brainId: brain.brainId, path },
      select: {
        id: true,
        path: true,
        contentHash: true,
        provenance: true,
        validationStatus: true,
        validatedAt: true,
        validatedBy: true,
        validatedHash: true,
        disqualifiedAt: true,
        disqualifiedBy: true,
      },
    });

    if (!doc) {
      return NextResponse.json(
        { error: `Document not found: ${path}` },
        { status: 404 },
      );
    }

    // Last N log entries inline so the UI can show "validation history"
    // without a second round-trip. Capped — full log API ships in Phase 4.
    const recent = await tx.vaultValidationLog.findMany({
      where: { documentId: doc.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      id: doc.id,
      path: doc.path,
      contentHash: doc.contentHash,
      validation: {
        status: doc.validationStatus,
        provenance: doc.provenance,
        validatedAt: doc.validatedAt?.toISOString() ?? null,
        validatedBy: doc.validatedBy,
        validatedHash: doc.validatedHash,
        disqualifiedAt: doc.disqualifiedAt?.toISOString() ?? null,
        disqualifiedBy: doc.disqualifiedBy,
      },
      recentLog: recent.map((r) => ({
        id: r.id,
        fromStatus: r.fromStatus,
        toStatus: r.toStatus,
        contentHashAt: r.contentHashAt,
        source: r.source,
        changedBy: r.changedBy,
        actorType: r.actorType,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  }

  // Brain-wide breakdown. Two grouped counts feed the document-list header
  // bar: by status (validated/unvalidated/stale/disqualified) and by
  // provenance (human/agent/ingested). Total is derived client-side.
  const [byStatus, byProvenance, total] = await Promise.all([
    tx.vaultDocument.groupBy({
      by: ["validationStatus"],
      where: { brainId: brain.brainId },
      _count: { _all: true },
    }),
    tx.vaultDocument.groupBy({
      by: ["provenance"],
      where: { brainId: brain.brainId },
      _count: { _all: true },
    }),
    tx.vaultDocument.count({ where: { brainId: brain.brainId } }),
  ]);

  return NextResponse.json({
    brain: brain.brainName,
    total,
    counts: {
      validated: countOf(byStatus, "validated"),
      unvalidated: countOf(byStatus, "unvalidated"),
      stale: countOf(byStatus, "stale"),
      disqualified: countOf(byStatus, "disqualified"),
    },
    byProvenance: {
      human: countOf(byProvenance, "human", "provenance"),
      agent: countOf(byProvenance, "agent", "provenance"),
      ingested: countOf(byProvenance, "ingested", "provenance"),
    },
  });
});

function countOf<TKey extends string>(
  rows: Array<{ _count: { _all: number } } & Record<string, unknown>>,
  value: string,
  key: TKey = "validationStatus" as TKey,
): number {
  for (const r of rows) {
    if (r[key] === value) return r._count._all;
  }
  return 0;
}
