import { NextResponse } from "next/server";
import { resolveBrain, isBrainError } from "@/lib/vault";
import { resolveDocumentContent } from "@/lib/vault/query-block";
import { authedTenantRoute } from "@/lib/route-helpers";

export const GET = authedTenantRoute(async ({ req, tx, principal }) => {
  const brain = await resolveBrain(tx, req, principal);
  if (isBrainError(brain)) return brain;

  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json(
      { error: "Missing required parameter: path" },
      { status: 400 },
    );
  }

  const doc = await tx.vaultDocument.findFirst({
    where: { brainId: brain.brainId, path },
  });

  if (!doc) {
    return NextResponse.json(
      { error: `Document not found: ${path}` },
      { status: 404 },
    );
  }

  // Opt-in, display-only resolution of ```aju-query``` blocks. We return the
  // rendered content but keep the raw `contentHash` untouched so edit / update
  // / CAS keep operating on the stored source — resolution must never feed a
  // write path. Callers that intend to edit must NOT pass resolve.
  const resolve = req.nextUrl.searchParams.get("resolve");
  if (resolve === "1" || resolve === "true") {
    const content = await resolveDocumentContent(
      tx,
      [brain.brainId],
      doc.content,
    );
    return { ...doc, content, resolved: true };
  }

  return doc;
});
