import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client-tenant";
import { z } from "zod";
import { parseDocument } from "@/lib/vault";
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

const updateDocSchema = z.object({
  path: vaultPathSchema,
  content: documentContentSchema,
  source: vaultSourceSchema,
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
    const { path, content, source } = validation.value;

    const existing = await tx.vaultDocument.findFirst({
      where: { brainId: brain.brainId, path },
    });

    if (!existing) {
      return NextResponse.json(
        { error: `Document not found: ${path}` },
        { status: 404 },
      );
    }

    const parsed = parseDocument(content, path);

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

    return updated;
  },
);
