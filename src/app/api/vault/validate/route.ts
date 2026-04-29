import { NextResponse } from "next/server";
import { z } from "zod";
import { authedTenantRoute } from "@/lib/route-helpers";
import {
  resolveBrain,
  isBrainError,
  canValidate,
} from "@/lib/vault";
import {
  validateBody,
  vaultPathSchema,
  vaultSourceSchema,
} from "@/lib/validators";

// Single endpoint covering all four state transitions. The behavior
// branches on `status`; folding mark-stale / disqualify / clear-validation
// into one route keeps the API surface tight and the audit log shape
// identical for every transition.
//
// Critical: snapshot the contentHash *inside* the tx by re-reading the doc.
// Never trust a client-supplied hash — that would let a stale page from
// an unrelated tab "validate" content the user hasn't actually seen.
const validateBodySchema = z.object({
  path: vaultPathSchema,
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

    const validation = await validateBody(req, validateBodySchema);
    if (!validation.ok) return validation.response;
    const { path, status, reason, source } = validation.value;

    // Re-read inside the tx so the contentHash snapshot reflects the
    // server's current truth, not the caller's. RLS already scopes by brain.
    const existing = await tx.vaultDocument.findFirst({
      where: { brainId: brain.brainId, path },
    });

    if (!existing) {
      return NextResponse.json(
        { error: `Document not found: ${path}` },
        { status: 404 },
      );
    }

    if (existing.validationStatus === status) {
      // No-op: caller already at this state. Return current shape so the
      // UI can re-render without retrying. Don't write a log row — the
      // log records *transitions*, not idle pings.
      return NextResponse.json(buildValidationResponse(existing));
    }

    const now = new Date();
    const data: Record<string, unknown> = {
      validationStatus: status,
    };

    switch (status) {
      case "validated":
        data.validatedAt = now;
        data.validatedBy = principal.identity;
        data.validatedHash = existing.contentHash;
        // Clearing disqualified pointers on promotion keeps the doc-level
        // state legible: a validated doc shouldn't carry a stale "who
        // disqualified me" tombstone.
        data.disqualifiedAt = null;
        data.disqualifiedBy = null;
        break;
      case "disqualified":
        data.disqualifiedAt = now;
        data.disqualifiedBy = principal.identity;
        // Don't touch the validated_* fields — preserve the prior
        // validation snapshot in case the disqualification is later
        // reversed and we want the audit trail.
        break;
      case "stale":
        // Manual mark-as-stale. Don't change validatedHash or disqualified
        // pointers; this is the user saying "I know the source has shifted
        // even though the text hasn't been re-edited yet."
        break;
      case "unvalidated":
        // Clear all pointers. Used to revert a validation/disqualification
        // back to the default state, e.g. "I shouldn't have validated this."
        data.validatedAt = null;
        data.validatedBy = null;
        data.validatedHash = null;
        data.disqualifiedAt = null;
        data.disqualifiedBy = null;
        break;
    }

    const updated = await tx.vaultDocument.update({
      where: { id: existing.id },
      data,
    });

    await tx.vaultValidationLog.create({
      data: {
        brainId: brain.brainId,
        documentId: existing.id,
        path,
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

    return NextResponse.json(buildValidationResponse(updated));
  },
  { requiresScope: "write" },
);

function buildValidationResponse(doc: {
  id: string;
  path: string;
  contentHash: string;
  provenance: string;
  validationStatus: string;
  validatedAt: Date | null;
  validatedBy: string | null;
  validatedHash: string | null;
  disqualifiedAt: Date | null;
  disqualifiedBy: string | null;
}) {
  return {
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
  };
}
