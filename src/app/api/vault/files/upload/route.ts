import { NextRequest, NextResponse } from "next/server";
import { storageFor } from "@/lib/tenant";
import { extractText, computeTextHash } from "@/lib/storage";
import { updateFileEmbedding } from "@/lib/embeddings";
import { resolveBrain, isBrainError, canWrite } from "@/lib/vault";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { authedTenantRoute } from "@/lib/route-helpers";

// Reject obviously oversized requests before buffering, based on
// Content-Length. The JSON body is ~4/3 the size of the decoded file
// (base64 overhead), so allow a generous envelope but still cap well
// below unlimited. Runs OUTSIDE the helper so we don't pay the auth +
// transaction cost on requests we'll reject anyway.
function checkContentLength(req: NextRequest): NextResponse | null {
  const header = req.headers.get("content-length");
  if (!header) return null;
  const len = Number(header);
  if (Number.isFinite(len) && len > MAX_UPLOAD_BYTES * 2) {
    return NextResponse.json(
      { error: "file_too_large", maxBytes: MAX_UPLOAD_BYTES },
      { status: 413 },
    );
  }
  return null;
}

const handler = authedTenantRoute(
  async ({ req, tenant, tx, organizationId, principal }) => {
    const brain = await resolveBrain(tx, req, principal);
    if (isBrainError(brain)) return brain;
    if (!canWrite(brain)) {
      return NextResponse.json(
        { error: "Read-only access to this brain" },
        { status: 403 },
      );
    }

    const body = await req.json();
    const {
      filename,
      base64Content,
      contentType,
      category,
      tags,
      source,
    } = body as {
      filename?: string;
      base64Content?: string;
      contentType?: string;
      category?: string;
      tags?: string[];
      source?: string;
    };

    if (!filename || !base64Content || !contentType || !source) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: filename, base64Content, contentType, source",
        },
        { status: 400 },
      );
    }

    // Key is rooted on brainId (immutable cuid) rather than brainName. Two
    // orgs can each have a brain called "Personal"; with brainName in the
    // shared-bucket path their uploads would collide and silently overwrite.
    // brainId is globally unique and rename-safe.
    const s3Key = category
      ? `${brain.brainId}/files/${category}/${filename}`
      : `${brain.brainId}/files/${filename}`;

    const existing = await tx.vaultFile.findUnique({ where: { s3Key } });
    if (existing) {
      return NextResponse.json(
        { error: `File already exists: ${s3Key}` },
        { status: 409 },
      );
    }

    const buffer = Buffer.from(base64Content, "base64");

    // Authoritative size check on the decoded payload — Content-Length can
    // be missing or misleading.
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "file_too_large", maxBytes: MAX_UPLOAD_BYTES },
        { status: 413 },
      );
    }

    const storage = await storageFor(organizationId);
    await storage.put(s3Key, buffer, contentType);

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

    if (text) {
      updateFileEmbedding(tenant, file.id).catch((err) =>
        console.error("Embedding after upload failed:", err),
      );
    }

    return NextResponse.json(file, { status: 201 });
  },
);

export async function POST(req: NextRequest) {
  const tooLarge = checkContentLength(req);
  if (tooLarge) return tooLarge;
  return handler(req);
}
