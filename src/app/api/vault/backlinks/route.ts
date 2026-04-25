import { NextResponse } from "next/server";
import { resolveBrain, isBrainError } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

export const GET = authedTenantRoute(async ({ req, tx, principal }) => {
  const brain = await resolveBrain(tx, req, principal);
  if (isBrainError(brain)) return brain;

  const docPath = req.nextUrl.searchParams.get("path");
  if (!docPath) {
    return NextResponse.json(
      { error: "Missing required parameter: path" },
      { status: 400 },
    );
  }

  const doc = await tx.vaultDocument.findFirst({
    where: { brainId: brain.brainId, path: docPath },
    select: { id: true },
  });

  if (!doc) {
    return NextResponse.json(
      { error: `Document not found: ${docPath}` },
      { status: 404 },
    );
  }

  const links = await tx.documentLink.findMany({
    where: { targetId: doc.id },
    include: {
      source: {
        select: {
          path: true,
          title: true,
          section: true,
          docType: true,
          docStatus: true,
          tags: true,
        },
      },
    },
  });

  return {
    path: docPath,
    count: links.length,
    backlinks: links.map((l) => ({
      linkText: l.linkText,
      source: l.source,
    })),
  };
});
