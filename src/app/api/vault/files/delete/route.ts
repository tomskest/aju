import { NextResponse } from "next/server";
import { storageFor } from "@/lib/tenant";
import { resolveBrain, isBrainError, canWrite } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

export const POST = authedTenantRoute(
  async ({ req, tx, organizationId, principal }) => {
    const brain = await resolveBrain(tx, req, principal);
    if (isBrainError(brain)) return brain;
    if (!canWrite(brain)) {
      return NextResponse.json(
        { error: "Read-only access to this brain" },
        { status: 403 },
      );
    }

    const body = await req.json();
    const { key, source } = body as { key?: string; source?: string };

    if (!key || !source) {
      return NextResponse.json(
        { error: "Missing required fields: key, source" },
        { status: 400 },
      );
    }

    const existing = await tx.vaultFile.findFirst({
      where: { s3Key: key, brainId: brain.brainId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: `File not found: ${key}` },
        { status: 404 },
      );
    }

    // Log before deleting
    await tx.vaultChangeLog.create({
      data: {
        documentId: null,
        path: key,
        operation: "file-delete",
        source,
        changedBy: principal.identity,
        brainId: brain.brainId,
      },
    });

    // Delete from the tenant bucket then Postgres.
    const storage = await storageFor(organizationId);
    await storage.delete(key);
    await tx.vaultFile.delete({ where: { id: existing.id } });

    return { deleted: key };
  },
  { requiresScope: "delete" },
);
