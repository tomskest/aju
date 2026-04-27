import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client-tenant";
import { z } from "zod";
import { parseDocument } from "@/lib/vault";
import { scheduleRebuildLinks, autoLinkDocument } from "@/lib/vault";
import { updateDocumentEmbedding } from "@/lib/embeddings";
import { resolveBrain, isBrainError, canWrite } from "@/lib/vault";
import { enforceDocumentsPerBrainLimit } from "@/lib/billing";
import { authedTenantRoute } from "@/lib/route-helpers";
import {
  documentContentSchema,
  validateBody,
  vaultPathSchema,
  vaultSourceSchema,
} from "@/lib/validators";

const createDocSchema = z.object({
  path: vaultPathSchema,
  content: documentContentSchema,
  source: vaultSourceSchema,
});

export const POST = authedTenantRoute(
  async ({ req, tenant, tx, user, principal }) => {
    const brain = await resolveBrain(tx, req, principal);
    if (isBrainError(brain)) return brain;

    if (!canWrite(brain)) {
      return NextResponse.json(
        { error: "Write access denied for this brain" },
        { status: 403 },
      );
    }

    // Plan-limit gate: documentsPerBrain. Agent principals inherit the user
    // slot's tier (the user is the human who minted the agent key).
    //
    // Uses `tx` so the count shares the open interactive transaction instead
    // of racing it on a separate pgbouncer connection.
    const limitErr = await enforceDocumentsPerBrainLimit(
      tx,
      brain.brainId,
      user.id,
    );
    if (limitErr) return limitErr;

    const validation = await validateBody(req, createDocSchema);
    if (!validation.ok) return validation.response;
    const { path, content, source } = validation.value;

    const existing = await tx.vaultDocument.findFirst({
      where: { brainId: brain.brainId, path },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Document already exists: ${path}` },
        { status: 409 },
      );
    }

    const parsed = parseDocument(content, path);

    const doc = await tx.vaultDocument.create({
      data: {
        brainId: brain.brainId,
        path,
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
        fileModified: new Date(),
        syncedAt: new Date(),
      },
    });
    // Genesis version row — parentHash null, versionN = 1.
    await tx.vaultDocumentVersion.create({
      data: {
        brainId: brain.brainId,
        documentId: doc.id,
        path,
        versionN: 1,
        content: parsed.content,
        contentHash: parsed.contentHash,
        parentHash: null,
        mergeParentHash: null,
        source,
        changedBy: principal.identity,
      },
    });
    await tx.vaultChangeLog.create({
      data: {
        brainId: brain.brainId,
        documentId: doc.id,
        path,
        operation: "insert",
        source,
        changedBy: principal.identity,
      },
    });

    // Bulk-ingest callers (importers, benchmark harnesses) can set
    // ?defer_index=1 to skip the per-create link rebuild + embedding
    // generation. They're expected to call POST /api/vault/reindex once
    // after the import completes, which handles links + embeddings + FTS in
    // one batched pass. Without this flag, a 50-doc import triggers 50
    // rebuilds and 50 Voyage calls, which serialize on the per-brain
    // advisory lock and the embedding queue.
    const deferIndex = req.nextUrl.searchParams.get("defer_index") === "1";

    if (!deferIndex) {
      // Auto-link first (may modify the doc body), then rebuild the
      // graph + embedding. If auto-link adds wikilinks, the rebuild
      // picks up the new edges and the embedding refresh sees the
      // updated content. Chained sequentially in one fire-and-forget so
      // the rebuild doesn't race the auto-link's UPDATE.
      autoLinkDocument(tenant, brain.brainId, doc.id)
        .then(() => {
          scheduleRebuildLinks(tenant, brain.brainId).catch((err) =>
            console.error("Link rebuild after create failed:", err),
          );
          return updateDocumentEmbedding(tenant, doc.id);
        })
        .catch((err) =>
          console.error("Auto-link / embedding after create failed:", err),
        );
    }

    return NextResponse.json(doc, { status: 201 });
  },
);
