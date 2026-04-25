import { NextResponse } from "next/server";
import type { Prisma as PrismaTenant } from "@prisma/client-tenant";
import { resolveBrain, isBrainError } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

type TenantTx = PrismaTenant.TransactionClient;

export const GET = authedTenantRoute(async ({ req, tx, principal }) => {
  const brain = await resolveBrain(tx, req, principal);
  if (isBrainError(brain)) return brain;

  const mode = req.nextUrl.searchParams.get("mode") || "stats";

  if (mode === "stats") {
    return handleStats(tx, brain.brainId);
  }

  if (mode === "neighbors") {
    const docPath = req.nextUrl.searchParams.get("path");
    if (!docPath) {
      return NextResponse.json(
        { error: "Missing required parameter: path (for mode=neighbors)" },
        { status: 400 },
      );
    }
    return handleNeighbors(tx, docPath, brain.brainId);
  }

  return NextResponse.json(
    { error: `Unknown mode: ${mode}. Use 'stats' or 'neighbors'.` },
    { status: 400 },
  );
});

async function handleStats(tx: TenantTx, brainId: string) {
  const [totalDocs, totalLinks] = await Promise.all([
    tx.vaultDocument.count({ where: { brainId } }),
    tx.$queryRaw<Array<{ count: string }>>`
      SELECT COUNT(*)::text as count
      FROM document_links dl
      JOIN vault_documents vd ON vd.id = dl.source_id
      WHERE vd.brain_id = ${brainId}
    `.then((r) => parseInt(r[0]?.count || "0", 10)),
  ]);

  // Orphan documents: no incoming or outgoing links
  const orphans = await tx.$queryRaw<
    Array<{ count: string }>
  >`
    SELECT COUNT(*) as count
    FROM vault_documents vd
    WHERE vd.brain_id = ${brainId}
    AND NOT EXISTS (
      SELECT 1 FROM document_links dl WHERE dl.source_id = vd.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM document_links dl WHERE dl.target_id = vd.id
    )
  `;

  // Top 20 most-linked-to documents
  const mostLinked = await tx.$queryRaw<
    Array<{
      path: string;
      title: string;
      section: string;
      incoming_count: string;
    }>
  >`
    SELECT vd.path, vd.title, vd.section,
           COUNT(dl.id)::text AS incoming_count
    FROM vault_documents vd
    JOIN document_links dl ON dl.target_id = vd.id
    WHERE vd.brain_id = ${brainId}
    GROUP BY vd.id, vd.path, vd.title, vd.section
    ORDER BY COUNT(dl.id) DESC
    LIMIT 20
  `;

  return NextResponse.json({
    totalDocuments: totalDocs,
    totalLinks,
    orphanDocuments: parseInt(orphans[0]?.count || "0", 10),
    mostLinkedDocuments: mostLinked.map((d) => ({
      path: d.path,
      title: d.title,
      section: d.section,
      incomingLinks: parseInt(d.incoming_count, 10),
    })),
  });
}

async function handleNeighbors(tx: TenantTx, docPath: string, brainId: string) {
  const doc = await tx.vaultDocument.findFirst({
    where: { brainId, path: docPath },
    select: { id: true },
  });

  if (!doc) {
    return NextResponse.json(
      { error: `Document not found: ${docPath}` },
      { status: 404 },
    );
  }

  // 2-hop ego-network via recursive CTE
  const edges = await tx.$queryRaw<
    Array<{
      source_path: string;
      source_title: string;
      target_path: string;
      target_title: string;
      hop: number;
    }>
  >`
    WITH RECURSIVE neighbors AS (
      -- Hop 1: direct links (outgoing)
      SELECT dl.source_id, dl.target_id, 1 AS hop
      FROM document_links dl
      WHERE dl.source_id = ${doc.id}

      UNION

      -- Hop 1: direct links (incoming)
      SELECT dl.source_id, dl.target_id, 1 AS hop
      FROM document_links dl
      WHERE dl.target_id = ${doc.id}

      UNION

      -- Hop 2: links from/to hop-1 nodes
      SELECT dl.source_id, dl.target_id, 2 AS hop
      FROM document_links dl
      JOIN neighbors n ON (dl.source_id = n.target_id OR dl.source_id = n.source_id
                        OR dl.target_id = n.target_id OR dl.target_id = n.source_id)
      WHERE n.hop = 1
        AND dl.source_id != ${doc.id} AND dl.target_id != ${doc.id}
    )
    SELECT DISTINCT
      src.path AS source_path,
      src.title AS source_title,
      tgt.path AS target_path,
      tgt.title AS target_title,
      n.hop
    FROM neighbors n
    JOIN vault_documents src ON src.id = n.source_id
    JOIN vault_documents tgt ON tgt.id = n.target_id
    LIMIT 200
  `;

  // Collect unique nodes
  const nodes = new Map<string, { path: string; title: string }>();
  nodes.set(docPath, {
    path: docPath,
    title: docPath,
  });

  for (const edge of edges) {
    if (!nodes.has(edge.source_path)) {
      nodes.set(edge.source_path, {
        path: edge.source_path,
        title: edge.source_title,
      });
    }
    if (!nodes.has(edge.target_path)) {
      nodes.set(edge.target_path, {
        path: edge.target_path,
        title: edge.target_title,
      });
    }
  }

  return NextResponse.json({
    center: docPath,
    nodes: Array.from(nodes.values()),
    edges: edges.map((e) => ({
      source: e.source_path,
      target: e.target_path,
      hop: e.hop,
    })),
  });
}
