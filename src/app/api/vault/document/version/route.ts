import { NextResponse } from "next/server";
import { resolveBrain, isBrainError } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

// Fetch a single historical version of a document, including its full
// content. Address by either &n=<versionN> or &hash=<contentHash> — the
// latter is what you'd send to /api/vault/update as `baseHash` to
// "rebase onto an old version" when a write went sideways.
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

  const nParam = req.nextUrl.searchParams.get("n");
  const hashParam = req.nextUrl.searchParams.get("hash");
  if (!nParam && !hashParam) {
    return NextResponse.json(
      { error: "Provide either ?n=<versionN> or ?hash=<contentHash>" },
      { status: 400 },
    );
  }

  const doc = await tx.vaultDocument.findFirst({
    where: { brainId: brain.brainId, path },
    select: { id: true },
  });
  if (!doc) {
    return NextResponse.json(
      { error: `Document not found: ${path}` },
      { status: 404 },
    );
  }

  const where: Record<string, unknown> = {
    brainId: brain.brainId,
    documentId: doc.id,
  };
  if (nParam) {
    const n = parseInt(nParam, 10);
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json(
        { error: "Invalid version number: ?n must be a positive integer" },
        { status: 400 },
      );
    }
    where.versionN = n;
  } else if (hashParam) {
    if (!/^[a-f0-9]{64}$/.test(hashParam)) {
      return NextResponse.json(
        { error: "Invalid content hash: ?hash must be sha256 hex" },
        { status: 400 },
      );
    }
    where.contentHash = hashParam;
  }

  const version = await tx.vaultDocumentVersion.findFirst({
    where,
    select: {
      id: true,
      versionN: true,
      content: true,
      contentHash: true,
      parentHash: true,
      mergeParentHash: true,
      source: true,
      changedBy: true,
      message: true,
      createdAt: true,
    },
  });
  if (!version) {
    return NextResponse.json(
      { error: "Version not found" },
      { status: 404 },
    );
  }

  return {
    path,
    id: version.id,
    versionN: version.versionN,
    content: version.content,
    contentHash: version.contentHash,
    parentHash: version.parentHash,
    mergeParentHash: version.mergeParentHash,
    source: version.source,
    changedBy: version.changedBy,
    message: version.message,
    createdAt: version.createdAt.toISOString(),
  };
});
