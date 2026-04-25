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
    select: { id: true, tags: true },
  });

  if (!doc) {
    return NextResponse.json(
      { error: `Document not found: ${docPath}` },
      { status: 404 },
    );
  }

  // 1. Outgoing links (this doc → others)
  const outgoing = await tx.documentLink.findMany({
    where: { sourceId: doc.id },
    include: {
      target: {
        select: {
          path: true,
          title: true,
          section: true,
          docType: true,
          tags: true,
        },
      },
    },
  });

  // 2. Incoming links (others → this doc)
  const incoming = await tx.documentLink.findMany({
    where: { targetId: doc.id },
    include: {
      source: {
        select: {
          path: true,
          title: true,
          section: true,
          docType: true,
          tags: true,
        },
      },
    },
  });

  // 3. Tag neighbors (docs sharing ≥1 tag, ranked by overlap count)
  let tagNeighbors: Array<{
    path: string;
    title: string;
    section: string;
    doc_type: string | null;
    shared_tags: number;
  }> = [];

  if (doc.tags.length > 0) {
    tagNeighbors = await tx.$queryRaw<typeof tagNeighbors>`
      SELECT path, title, section, doc_type,
             array_length(
               ARRAY(SELECT unnest(tags) INTERSECT SELECT unnest(${doc.tags}::text[])),
               1
             ) AS shared_tags
      FROM vault_documents
      WHERE id != ${doc.id}
        AND brain_id = ${brain.brainId}
        AND tags && ${doc.tags}::text[]
      ORDER BY shared_tags DESC
      LIMIT 20
    `;
  }

  // Deduplicate across all three sources
  const seen = new Set<string>();
  const related: Array<{
    path: string;
    title: string;
    section: string;
    docType: string | null;
    relationship: string;
  }> = [];

  for (const link of outgoing) {
    if (!seen.has(link.target.path)) {
      seen.add(link.target.path);
      related.push({
        path: link.target.path,
        title: link.target.title,
        section: link.target.section,
        docType: link.target.docType,
        relationship: "outgoing_link",
      });
    }
  }

  for (const link of incoming) {
    if (!seen.has(link.source.path)) {
      seen.add(link.source.path);
      related.push({
        path: link.source.path,
        title: link.source.title,
        section: link.source.section,
        docType: link.source.docType,
        relationship: "incoming_link",
      });
    }
  }

  for (const neighbor of tagNeighbors) {
    if (!seen.has(neighbor.path)) {
      seen.add(neighbor.path);
      related.push({
        path: neighbor.path,
        title: neighbor.title,
        section: neighbor.section,
        docType: neighbor.doc_type,
        relationship: `tag_neighbor (${neighbor.shared_tags} shared)`,
      });
    }
  }

  return {
    path: docPath,
    count: related.length,
    related,
  };
});
