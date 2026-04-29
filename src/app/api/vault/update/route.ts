import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client-tenant";
import { z } from "zod";
import { parseDocument, threeWayMerge } from "@/lib/vault";
import { scheduleRebuildLinks, autoLinkDocument } from "@/lib/vault";
import { updateDocumentEmbedding } from "@/lib/embeddings";
import { resolveBrain, isBrainError, canWrite } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";
import {
  documentContentSchema,
  validateBody,
  vaultPathSchema,
  vaultSourceSchema,
} from "@/lib/validators";

// Compare-and-swap protocol:
//
//   - If `baseHash` is omitted, the request acts as a force-write (legacy).
//     The response carries a `Deprecation` header so callers learn to migrate.
//   - If `baseHash` matches the document's current contentHash, the write
//     fast-paths to a normal commit.
//   - If `baseHash` is provided but does not match the current head:
//       - When `baseContent` is also provided, attempt a three-way merge
//         (base = baseContent, theirs = head, mine = incoming). On clean
//         merge, commit the merged content and respond 200 with `merged: true`.
//       - On merge conflict (or when `baseContent` is missing), return 409
//         with the current head hash + content so the caller can rebase.
const updateDocSchema = z.object({
  path: vaultPathSchema,
  content: documentContentSchema,
  source: vaultSourceSchema,
  // SHA-256 hex of the document content the caller had at read time.
  // Optional only for the legacy force-write path; new callers should send it.
  baseHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "baseHash_must_be_sha256_hex")
    .optional(),
  // The exact content the caller had at read time. When provided alongside
  // a mismatched baseHash, the server attempts a three-way merge instead
  // of bouncing the write straight to 409. Same size cap as `content`.
  baseContent: documentContentSchema.optional(),
});

export const POST = authedTenantRoute(
  async ({ req, tenant, tx, principal }) => {
    const brain = await resolveBrain(tx, req, principal);
    if (isBrainError(brain)) return brain;

    if (!canWrite(brain)) {
      return NextResponse.json(
        { error: "Write access denied for this brain" },
        { status: 403 },
      );
    }

    const validation = await validateBody(req, updateDocSchema);
    if (!validation.ok) return validation.response;
    const { path, content, source, baseHash, baseContent } = validation.value;

    const existing = await tx.vaultDocument.findFirst({
      where: { brainId: brain.brainId, path },
    });

    if (!existing) {
      return NextResponse.json(
        { error: `Document not found: ${path}` },
        { status: 404 },
      );
    }

    // CAS check + optional three-way merge.
    //
    // If baseHash is provided and disagrees with the current head:
    //   - With baseContent → run diff3 against (base, theirs, mine). Clean
    //     merge wins; we commit the merged content and tag the response
    //     with `merged: true` so the caller knows it landed via merge.
    //   - Without baseContent (or on conflict) → 409 with the current head
    //     so the caller can re-read, re-apply its intent, and retry.
    let resolvedContent = content;
    let merged = false;
    let mergedFromHeadHash: string | null = null;
    if (baseHash && baseHash !== existing.contentHash) {
      if (baseContent === undefined) {
        return NextResponse.json(
          {
            error: "stale_base_hash",
            message:
              "Document has changed since you read it. Re-read, re-apply your edit against the current head, and retry. (Pass baseContent on update to enable server-side three-way merge.)",
            headHash: existing.contentHash,
            headContent: existing.content,
            baseHash,
          },
          { status: 409 },
        );
      }

      const merge = threeWayMerge(baseContent, existing.content, content);
      if (!merge.ok) {
        return NextResponse.json(
          {
            error: "merge_conflict",
            message:
              "Concurrent edits to overlapping regions. The server attempted a three-way merge and conflict markers remain. Resolve and retry.",
            headHash: existing.contentHash,
            headContent: existing.content,
            baseHash,
            baseContent,
            mineContent: content,
            conflictedContent: merge.conflicted,
          },
          { status: 409 },
        );
      }

      resolvedContent = merge.merged;
      merged = true;
      mergedFromHeadHash = existing.contentHash;
    }

    const parsed = parseDocument(resolvedContent, path);

    // Auto-invalidation: editing the content invalidates a prior validation.
    // Two transitions, both same-tx so the validation state never desyncs
    // from the content.
    //   - validated -> stale: hash mismatch means the validated text was
    //     edited. Don't clear validatedAt/By/Hash — the original validation
    //     event is preserved in the log; re-validation rewrites the snapshot.
    //   - disqualified -> unvalidated: editing a disqualified doc is a
    //     correction in progress; drop it back to unvalidated so the user
    //     can re-evaluate without manually clearing.
    let nextValidationStatus = existing.validationStatus;
    let validationLogTransition: {
      from: string;
      to: string;
      reason: string;
    } | null = null;

    if (parsed.contentHash !== existing.contentHash) {
      if (
        existing.validationStatus === "validated" &&
        existing.validatedHash !== parsed.contentHash
      ) {
        nextValidationStatus = "stale";
        validationLogTransition = {
          from: "validated",
          to: "stale",
          reason: "auto: content edited",
        };
      } else if (existing.validationStatus === "disqualified") {
        nextValidationStatus = "unvalidated";
        validationLogTransition = {
          from: "disqualified",
          to: "unvalidated",
          reason: "auto: disqualified content edited",
        };
      }
    }

    const updated = await tx.vaultDocument.update({
      where: { id: existing.id },
      data: {
        title: parsed.title,
        frontmatter: (parsed.frontmatter ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        docType: parsed.docType,
        docStatus: parsed.docStatus,
        tags: parsed.tags,
        content: parsed.content,
        contentHash: parsed.contentHash,
        wordCount: parsed.wordCount,
        directory: parsed.directory,
        section: parsed.section,
        wikilinks: parsed.wikilinks,
        syncedAt: new Date(),
        validationStatus: nextValidationStatus,
        // Clearing the disqualified pointer when editing a disqualified
        // doc keeps the doc-level state consistent. The history log row
        // below preserves who/when the original disqualification was.
        ...(validationLogTransition?.to === "unvalidated"
          ? { disqualifiedAt: null, disqualifiedBy: null }
          : {}),
      },
    });

    if (validationLogTransition) {
      await tx.vaultValidationLog.create({
        data: {
          brainId: brain.brainId,
          documentId: existing.id,
          path,
          fromStatus: validationLogTransition.from,
          toStatus: validationLogTransition.to,
          fromProvenance: existing.provenance,
          toProvenance: existing.provenance,
          contentHashAt: parsed.contentHash,
          source: "system",
          changedBy: principal.identity,
          actorType: principal.agentId ? "agent" : "user",
          reason: validationLogTransition.reason,
        },
      });
    }
    // Append a version row. parentHash points at the head we replaced;
    // mergeParentHash captures the caller's baseHash on auto-merged
    // commits so the history forms a proper DAG of parent + merge-parent.
    const lastVersion = await tx.vaultDocumentVersion.findFirst({
      where: { documentId: existing.id },
      orderBy: { versionN: "desc" },
      select: { versionN: true },
    });
    await tx.vaultDocumentVersion.create({
      data: {
        brainId: brain.brainId,
        documentId: existing.id,
        path,
        versionN: (lastVersion?.versionN ?? 0) + 1,
        content: parsed.content,
        contentHash: parsed.contentHash,
        parentHash: existing.contentHash,
        mergeParentHash: merged ? baseHash ?? null : null,
        source,
        changedBy: principal.identity,
      },
    });
    await tx.vaultChangeLog.create({
      data: {
        brainId: brain.brainId,
        documentId: existing.id,
        path,
        operation: "update",
        source,
        changedBy: principal.identity,
      },
    });

    // Auto-link → rebuild graph → refresh embedding. Chained so each
    // step sees the previous one's writes. See the create route for the
    // same pattern.
    autoLinkDocument(tenant, brain.brainId, existing.id)
      .then(() => {
        scheduleRebuildLinks(tenant, brain.brainId).catch((err) =>
          console.error("Link rebuild after update failed:", err),
        );
        return updateDocumentEmbedding(tenant, existing.id);
      })
      .catch((err) =>
        console.error("Auto-link / embedding after update failed:", err),
      );

    // Force-write path emits a Deprecation header so callers notice the
    // migration target without being broken on this release. Once a
    // future release removes the legacy path, this header goes away and
    // missing `baseHash` becomes a 400.
    const headers: Record<string, string> = {};
    if (!baseHash) {
      headers["Deprecation"] =
        'true; reason="omit-baseHash is legacy; pass baseHash for compare-and-swap"';
    }
    return NextResponse.json(
      merged
        ? { ...updated, merged: true, mergedFromHeadHash }
        : updated,
      { headers },
    );
  },
  { requiresScope: "write" },
);
