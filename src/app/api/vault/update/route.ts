import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client-tenant";
import { parseDocument } from "@/lib/vault";
import { scheduleRebuildLinks } from "@/lib/vault";
import { updateDocumentEmbedding } from "@/lib/embeddings";
import { resolveBrain, isBrainError, canWrite } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

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

    const body = await req.json();
    const { path, content, source } = body as {
      path?: string;
      content?: string;
      source?: string;
    };

    if (!path || !content || !source) {
      return NextResponse.json(
        { error: "Missing required fields: path, content, source" },
        { status: 400 },
      );
    }

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

    // Rebuild link graph (fire-and-forget, scoped to this brain)
    scheduleRebuildLinks(tenant, brain.brainId).catch((err) =>
      console.error("Link rebuild after update failed:", err),
    );

    // Generate embedding (fire-and-forget)
    updateDocumentEmbedding(tenant, existing.id).catch((err) =>
      console.error("Embedding after update failed:", err),
    );

    return updated;
  },
);
