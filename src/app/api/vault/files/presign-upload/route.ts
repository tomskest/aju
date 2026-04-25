import { NextResponse } from "next/server";
import { storageFor } from "@/lib/tenant";
import { resolveBrain, isBrainError, canWrite } from "@/lib/vault";
import { enforceStorageLimit } from "@/lib/billing";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { validateS3PathSegment } from "@/lib/storage";
import { authedTenantRoute } from "@/lib/route-helpers";

export const POST = authedTenantRoute(
  async ({ req, tx, organizationId, user, principal }) => {
    const brain = await resolveBrain(tx, req, principal);
    if (isBrainError(brain)) return brain;
    if (!canWrite(brain)) {
      return NextResponse.json(
        { error: "Read-only access to this brain" },
        { status: 403 },
      );
    }

    const body = await req.json();
    const { filename, contentType, category, source, sizeBytes } = body as {
      filename?: string;
      contentType?: string;
      category?: string;
      source?: string;
      sizeBytes?: number;
    };

    if (!filename || !contentType || !source) {
      return NextResponse.json(
        { error: "Missing required fields: filename, contentType, source" },
        { status: 400 },
      );
    }

    // S3 key traversal guard: filename + category are interpolated into the
    // key path, so they must not contain separators, parent-dir markers,
    // control chars, etc.
    const filenameCheck = validateS3PathSegment(filename, "filename");
    if (!filenameCheck.ok) {
      return NextResponse.json(
        { error: filenameCheck.code },
        { status: 400 },
      );
    }
    let safeCategory: string | null = null;
    if (category !== undefined && category !== null && category !== "") {
      const categoryCheck = validateS3PathSegment(category, "category");
      if (!categoryCheck.ok) {
        return NextResponse.json(
          { error: categoryCheck.code },
          { status: 400 },
        );
      }
      safeCategory = categoryCheck.value;
    }
    const safeFilename = filenameCheck.value;

    // If the client declares a size up front, reject oversized files before
    // minting a presigned URL. The authoritative check runs in confirm-upload
    // (which reads the actual object size from S3 after upload completes).
    if (
      typeof sizeBytes === "number" &&
      Number.isFinite(sizeBytes) &&
      sizeBytes > MAX_UPLOAD_BYTES
    ) {
      return NextResponse.json(
        { error: "file_too_large", maxBytes: MAX_UPLOAD_BYTES },
        { status: 413 },
      );
    }

    // Plan-limit gate: storage cap. Only checked when the client advertises
    // a size — otherwise confirm-upload is the authoritative point (post-S3)
    // and any cap check there is additive. Hands `tx` in so the org-aggregate
    // reuses the already-open transaction instead of racing it on a separate
    // pgbouncer connection.
    if (
      typeof sizeBytes === "number" &&
      Number.isFinite(sizeBytes) &&
      principal.userId
    ) {
      const limitErr = await enforceStorageLimit(user.id, sizeBytes, {
        organizationId,
        tx,
      });
      if (limitErr) return limitErr;
    }

    // Key is rooted on brainId (immutable cuid) rather than brainName. Two
    // orgs can each have a brain called "Personal"; with brainName in the
    // shared-bucket path their uploads would collide and silently overwrite.
    // brainId is globally unique and rename-safe.
    const s3Key = safeCategory
      ? `${brain.brainId}/files/${safeCategory}/${safeFilename}`
      : `${brain.brainId}/files/${safeFilename}`;

    const existing = await tx.vaultFile.findUnique({ where: { s3Key } });
    if (existing) {
      return NextResponse.json(
        { error: `File already exists: ${s3Key}` },
        { status: 409 },
      );
    }

    const storage = await storageFor(organizationId);
    const uploadUrl = await storage.presignPut(s3Key, contentType);

    return {
      uploadUrl,
      s3Key,
      contentType,
      expiresIn: 3600,
      method: "PUT",
      headers: { "Content-Type": contentType },
      maxBytes: MAX_UPLOAD_BYTES,
    };
  },
);
