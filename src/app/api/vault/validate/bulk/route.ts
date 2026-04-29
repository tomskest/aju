import { NextResponse } from "next/server";
import { z } from "zod";
import { authedTenantRoute } from "@/lib/route-helpers";
import { resolveBrain, isBrainError, canValidate } from "@/lib/vault";
import {
  validateBody,
  vaultPathSchema,
  vaultSourceSchema,
} from "@/lib/validators";

// Bulk variant of POST /api/vault/validate. Same semantics per doc, just
// vectored. Cap at 200 paths/call so a single bulk doesn't hold the
// interactive transaction open longer than reasonable.
const BULK_LIMIT = 200;

const bulkSchema = z.object({
  paths: z.array(vaultPathSchema).min(1).max(BULK_LIMIT),
  status: z.enum(["validated", "stale", "disqualified", "unvalidated"]),
  reason: z.string().max(500).optional(),
  source: vaultSourceSchema,
});

export const POST = authedTenantRoute(
  async ({ req, tx, principal }) => {
    const brain = await resolveBrain(tx, req, principal);
    if (isBrainError(brain)) return brain;

    if (!canValidate(brain)) {
      return NextResponse.json(
        { error: "validation_forbidden", brainType: brain.brainType },
        { status: 403 },
      );
    }

    const validation = await validateBody(req, bulkSchema);
    if (!validation.ok) return validation.response;
    const { paths, status, reason, source } = validation.value;

    // Single tx so the bulk is atomic — if any single update fails the
    // whole batch rolls back. Avoids partial states like "47 of 50 docs
    // validated" that the user would have to clean up by hand.
    const docs = await tx.vaultDocument.findMany({
      where: { brainId: brain.brainId, path: { in: paths } },
    });
    const found = new Set(docs.map((d) => d.path));
    const missing = paths.filter((p) => !found.has(p));
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "documents_not_found",
          missing,
          message: "Some paths were not found; bulk aborted before any writes.",
        },
        { status: 404 },
      );
    }

    const now = new Date();
    let changed = 0;
    let skipped = 0;

    for (const existing of docs) {
      if (existing.validationStatus === status) {
        skipped += 1;
        continue;
      }

      const data: Record<string, unknown> = {
        validationStatus: status,
      };
      switch (status) {
        case "validated":
          data.validatedAt = now;
          data.validatedBy = principal.identity;
          data.validatedHash = existing.contentHash;
          data.disqualifiedAt = null;
          data.disqualifiedBy = null;
          break;
        case "disqualified":
          data.disqualifiedAt = now;
          data.disqualifiedBy = principal.identity;
          break;
        case "stale":
          break;
        case "unvalidated":
          data.validatedAt = null;
          data.validatedBy = null;
          data.validatedHash = null;
          data.disqualifiedAt = null;
          data.disqualifiedBy = null;
          break;
      }

      await tx.vaultDocument.update({
        where: { id: existing.id },
        data,
      });

      await tx.vaultValidationLog.create({
        data: {
          brainId: brain.brainId,
          documentId: existing.id,
          path: existing.path,
          fromStatus: existing.validationStatus,
          toStatus: status,
          fromProvenance: existing.provenance,
          toProvenance: existing.provenance,
          contentHashAt: existing.contentHash,
          source,
          changedBy: principal.identity,
          actorType: principal.agentId ? "agent" : "user",
          reason: reason ?? null,
        },
      });

      changed += 1;
    }

    return NextResponse.json({
      brain: brain.brainName,
      status,
      total: paths.length,
      changed,
      skipped,
    });
  },
  { requiresScope: "write" },
);
