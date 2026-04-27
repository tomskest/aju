import { NextResponse } from "next/server";
import { storageFor } from "@/lib/tenant";
import { extractText, computeTextHash } from "@/lib/storage";
import { updateFileEmbedding } from "@/lib/embeddings";
import { resolveBrain, isBrainError, canWrite } from "@/lib/vault";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { validateS3PathSegment } from "@/lib/storage";
import { authedTenantRoute } from "@/lib/route-helpers";

export const POST = authedTenantRoute(
  async ({ req, tenant, tx, organizationId, principal }) => {
    const brain = await resolveBrain(tx, req, principal);
    if (isBrainError(brain)) return brain;

    if (!canWrite(brain)) {
      return NextResponse.json(
        { error: "Write access denied for this brain" },
        { status: 403 },
      );
    }

    const body = await req.json();
    const { s3Key, filename, contentType, category, tags, source } = body as {
      s3Key?: string;
      filename?: string;
      contentType?: string;
      category?: string;
      tags?: string[];
      source?: string;
    };

    if (!s3Key || !filename || !contentType || !source) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: s3Key, filename, contentType, source",
        },
        { status: 400 },
      );
    }

    // Re-validate filename + category here too: s3Key is trusted (derived
    // from presign-upload output) but filename/category get written into the
    // DB row and are user-supplied on this call.
    const filenameCheck = validateS3PathSegment(filename, "filename");
    if (!filenameCheck.ok) {
      return NextResponse.json(
        { error: filenameCheck.code },
        { status: 400 },
      );
    }
    if (category !== undefined && category !== null && category !== "") {
      const categoryCheck = validateS3PathSegment(category, "category");
      if (!categoryCheck.ok) {
        return NextResponse.json(
          { error: categoryCheck.code },
          { status: 400 },
        );
      }
    }

    const existing = await tx.vaultFile.findUnique({ where: { s3Key } });
    if (existing) {
      return NextResponse.json(
        { error: `File already registered: ${s3Key}` },
        { status: 409 },
      );
    }

    // Read the file back from the tenant bucket for size + text extraction.
    const storage = await storageFor(organizationId);
    const buffer = await storage.get(s3Key);

    // Authoritative size check: the client bypassed the server during the
    // direct-to-S3 upload, so enforce the per-file cap here and clean up the
    // oversized object so it doesn't leak into the bucket.
    if (buffer.length > MAX_UPLOAD_BYTES) {
      try {
        await storage.delete(s3Key);
      } catch (err) {
        console.error("Failed to delete oversized upload:", err);
      }
      return NextResponse.json(
        { error: "file_too_large", maxBytes: MAX_UPLOAD_BYTES },
        { status: 413 },
      );
    }

    // Extract text (non-fatal)
    let text: string | null = null;
    let textHash: string | null = null;
    try {
      text = await extractText(buffer, contentType);
      if (text) textHash = computeTextHash(text);
    } catch (err) {
      console.error("Text extraction failed (non-fatal):", err);
    }

    const file = await tx.vaultFile.create({
      data: {
        s3Key,
        filename,
        mimeType: contentType,
        sizeBytes: buffer.length,
        category: category || null,
        tags: tags || [],
        extractedText: text,
        textHash,
        uploadedBy: principal.identity,
        brainId: brain.brainId,
      },
    });

    await tx.vaultChangeLog.create({
      data: {
        documentId: null,
        path: s3Key,
        operation: "file-upload",
        source,
        changedBy: principal.identity,
        brainId: brain.brainId,
      },
    });

    // Generate embedding (fire-and-forget). Uses the tenant client so the
    // raw UPDATE lands outside the request transaction.
    if (text) {
      updateFileEmbedding(tenant, file.id).catch((err) =>
        console.error("Embedding after confirm-upload failed:", err),
      );
    }

    return NextResponse.json(file, { status: 201 });
  },
  { requiresScope: "write" },
);
