import { NextResponse } from "next/server";
import { scheduleRebuildLinks } from "@/lib/vault";
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
    const { path, source } = body as { path?: string; source?: string };

    if (!path || !source) {
      return NextResponse.json(
        { error: "Missing required fields: path, source" },
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

    // Log BEFORE deleting (FK is SET NULL on delete)
    await tx.vaultChangeLog.create({
      data: {
        brainId: brain.brainId,
        documentId: existing.id,
        path,
        operation: "delete",
        source,
        changedBy: principal.identity,
      },
    });

    await tx.vaultDocument.delete({ where: { id: existing.id } });

    // Rebuild link graph (fire-and-forget, scoped to this brain)
    scheduleRebuildLinks(tenant, brain.brainId).catch((err) =>
      console.error("Link rebuild after delete failed:", err),
    );

    return { deleted: path };
  },
);
