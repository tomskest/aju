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

// Compare-and-swap protocol:
//
//   - If `baseHash` is omitted, the request acts as a force-write (legacy).
//     The response carries a `Deprecation` header so callers learn to migrate.
//   - If `baseHash` matches the document's current contentHash, the write
//     fast-paths to a normal commit.
//   - If `baseHash` is provided but does not match the current head, the
//     server returns 409 with the current head hash + content so the caller
//     can rebase its edit and retry.
//
// Three-way merge of non-overlapping edits is a planned follow-up; this
// route currently rejects every hash mismatch with 409 and lets the
// caller resolve.
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
    const { path, content, source, baseHash } = validation.value;

    const existing = await tx.vaultDocument.findFirst({
      where: { brainId: brain.brainId, path },
    });

    if (!existing) {
      return NextResponse.json(
        { error: `Document not found: ${path}` },
        { status: 404 },
      );
    }

    // CAS check. If baseHash is provided and disagrees with the current
    // head, refuse the write and hand the caller the current head so it
    // can rebase. Same shape as `git pull --rebase` — server is honest
    // about the conflict, client decides.
    if (baseHash && baseHash !== existing.contentHash) {
      return NextResponse.json(
        {
          error: "stale_base_hash",
          message:
            "Document has changed since you read it. Re-read, re-apply your edit against the current head, and retry.",
          headHash: existing.contentHash,
          headContent: existing.content,
          baseHash,
        },
        { status: 409 },
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

    // Force-write path emits a Deprecation header so callers notice the
    // migration target without being broken on this release. Once a
    // future release removes the legacy path, this header goes away and
    // missing `baseHash` becomes a 400.
    const headers: Record<string, string> = {};
    if (!baseHash) {
      headers["Deprecation"] =
        'true; reason="omit-baseHash is legacy; pass baseHash for compare-and-swap"';
    }
    return NextResponse.json(updated, { headers });
  },
);
