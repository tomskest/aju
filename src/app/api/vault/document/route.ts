import { NextResponse } from "next/server";
import { resolveBrain, isBrainError } from "@/lib/vault";
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

  return doc;
});
