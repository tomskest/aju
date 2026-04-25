import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client-tenant";
import { generateEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { resolveBrainIds, isBrainError } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

/**
 * GraphRAG deep search: hybrid search (RRF) + 1-hop graph expansion + re-ranking.
 *
 * 1. Hybrid search (FTS + vector via RRF) → top seed results
 * 2. Expand each seed via 1-hop graph neighbors (outgoing + incoming links)
 * 3. Score expanded docs by vector similarity to the query
 * 4. Re-rank all results: blend RRF score (if seed) + graph proximity + vector similarity
 * 5. Return enriched results with graph context (which seed linked to them, hop distance)
 */
export const GET = authedTenantRoute(async ({ req, tx, principal }) => {
  const brains = await resolveBrainIds(tx, req, principal);
  if (isBrainError(brains)) return brains;
  const brainIds = brains.map((b) => b.brainId);

  const url = req.nextUrl;
  const q = url.searchParams.get("q");
  if (!q) {
    return NextResponse.json(
      { error: "Missing required parameter: q" },
      { status: 400 },
    );
  }

  const section = url.searchParams.get("section");
  const docType = url.searchParams.get("type");
  const seeds = Math.min(
    parseInt(url.searchParams.get("seeds") || "5", 10),
    20,
  );
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "20", 10),
    100,
  );
  const depth = Math.min(
    parseInt(url.searchParams.get("depth") || "1", 10),
    2,
  );

  // Step 1: Generate query embedding. Voyage is asymmetric: queries must
  // use input_type="query" while indexed chunks use "document".
  const queryEmbedding = await generateEmbedding(q, "query");
  const vectorLiteral = toVectorLiteral(queryEmbedding);

  // Step 2: Hybrid search (RRF) to get seed documents
  const k = 60;
  const filters: Prisma.Sql[] = [
    Prisma.sql`brain_id = ANY(${brainIds}::text[])`,
  ];
  if (section) filters.push(Prisma.sql`section = ${section}`);
  if (docType) filters.push(Prisma.sql`doc_type = ${docType}`);
  const filterClause = Prisma.sql`AND ${Prisma.join(filters, " AND ")}`;

  const seedResults = await tx.$queryRaw<
    Array<{
      id: string;
      path: string;
      title: string;
      section: string;
      doc_type: string | null;
      doc_status: string | null;
      tags: string[];
      word_count: number;
      similarity: number | null;
      fts_rank: number | null;
      rrf_score: number;
    }>
  >`
    WITH vector_results AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${vectorLiteral}::vector) AS vec_rank,
             1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM vault_documents
      WHERE embedding IS NOT NULL ${filterClause}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT 100
    ),
    fts_results AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', ${q})) DESC) AS fts_rank,
             ts_rank(search_vector, websearch_to_tsquery('english', ${q})) AS fts_score
      FROM vault_documents
      WHERE search_vector @@ websearch_to_tsquery('english', ${q}) ${filterClause}
      ORDER BY fts_score DESC
      LIMIT 100
    ),
    combined AS (
      SELECT COALESCE(v.id, f.id) AS id,
             COALESCE(1.0 / (${k} + v.vec_rank), 0) + COALESCE(1.0 / (${k} + f.fts_rank), 0) AS rrf_score,
             v.similarity,
             f.fts_score AS fts_rank
      FROM vector_results v
      FULL OUTER JOIN fts_results f ON v.id = f.id
    )
    SELECT d.id, d.path, d.title, d.section, d.doc_type, d.doc_status,
           d.tags, d.word_count,
           c.similarity, c.fts_rank, c.rrf_score
    FROM combined c
    JOIN vault_documents d ON d.id = c.id
    ORDER BY c.rrf_score DESC
    LIMIT ${seeds}
  `;

  if (seedResults.length === 0) {
    return {
      query: q,
      seeds: 0,
      count: 0,
      results: [],
      graph: { nodes: 0, edges: [] },
    };
  }

  const seedIds = seedResults.map((r) => r.id);

  // Step 3: Graph expansion — get 1-hop (or 2-hop) neighbors of all seeds.
  // Each branch references seedIds via tagged-template binding so the
  // array is sent as a single parameter, not a string-spliced literal.
  type NeighborRow = { neighbor_id: string; seed_id: string; hop: number };

  const neighbors =
    depth === 1
      ? await tx.$queryRaw<Array<NeighborRow>>`
          SELECT DISTINCT
            CASE WHEN dl.source_id = ANY(${seedIds}::text[]) THEN dl.target_id ELSE dl.source_id END AS neighbor_id,
            CASE WHEN dl.source_id = ANY(${seedIds}::text[]) THEN dl.source_id ELSE dl.target_id END AS seed_id,
            1 AS hop
          FROM document_links dl
          WHERE dl.source_id = ANY(${seedIds}::text[]) OR dl.target_id = ANY(${seedIds}::text[])
        `
      : await tx.$queryRaw<Array<NeighborRow>>`
          WITH hop1 AS (
            SELECT DISTINCT
              CASE WHEN dl.source_id = ANY(${seedIds}::text[]) THEN dl.target_id ELSE dl.source_id END AS neighbor_id,
              CASE WHEN dl.source_id = ANY(${seedIds}::text[]) THEN dl.source_id ELSE dl.target_id END AS seed_id,
              1 AS hop
            FROM document_links dl
            WHERE dl.source_id = ANY(${seedIds}::text[]) OR dl.target_id = ANY(${seedIds}::text[])
          ),
          hop2 AS (
            SELECT DISTINCT
              CASE WHEN dl.source_id = h.neighbor_id THEN dl.target_id ELSE dl.source_id END AS neighbor_id,
              h.seed_id,
              2 AS hop
            FROM document_links dl
            JOIN hop1 h ON dl.source_id = h.neighbor_id OR dl.target_id = h.neighbor_id
            WHERE CASE WHEN dl.source_id = h.neighbor_id THEN dl.target_id ELSE dl.source_id END != ALL(${seedIds}::text[])
          )
          SELECT * FROM hop1
          UNION ALL
          SELECT * FROM hop2
        `;

  // Collect unique neighbor IDs (excluding seeds, they're already in results)
  const neighborMap = new Map<
    string,
    { seedIds: string[]; minHop: number }
  >();
  for (const n of neighbors) {
    if (seedIds.includes(n.neighbor_id)) continue;
    const existing = neighborMap.get(n.neighbor_id);
    if (existing) {
      if (!existing.seedIds.includes(n.seed_id))
        existing.seedIds.push(n.seed_id);
      existing.minHop = Math.min(existing.minHop, n.hop);
    } else {
      neighborMap.set(n.neighbor_id, {
        seedIds: [n.seed_id],
        minHop: n.hop,
      });
    }
  }

  const neighborIds = Array.from(neighborMap.keys());

  // Step 4: Score neighbors by vector similarity to the query
  let neighborDocs: Array<{
    id: string;
    path: string;
    title: string;
    section: string;
    doc_type: string | null;
    doc_status: string | null;
    tags: string[];
    word_count: number;
    similarity: number;
  }> = [];

  if (neighborIds.length > 0) {
    // Fetch more than `limit`; we trim to `limit` after blending scores.
    const fetchCount = limit * 3;
    neighborDocs = await tx.$queryRaw<typeof neighborDocs>`
      SELECT id, path, title, section, doc_type, doc_status, tags, word_count,
             CASE WHEN embedding IS NOT NULL
                  THEN 1 - (embedding <=> ${vectorLiteral}::vector)
                  ELSE 0 END AS similarity
      FROM vault_documents
      WHERE id = ANY(${neighborIds}::text[])
      ORDER BY CASE WHEN embedding IS NOT NULL
                    THEN embedding <=> ${vectorLiteral}::vector
                    ELSE 999 END
      LIMIT ${fetchCount}
    `;
  }

  // Step 5: Build unified result set with blended scores.
  // Seeds get: rrf_score (0-0.033) normalized to 0-1, plus graph boost.
  // Neighbors get: similarity (0-1) * graph proximity factor.

  const maxRrf = seedResults[0]?.rrf_score || 1;

  type ResultEntry = {
    id: string;
    path: string;
    title: string;
    section: string;
    docType: string | null;
    docStatus: string | null;
    tags: string[];
    wordCount: number;
    score: number;
    source: "seed" | "graph";
    similarity: number | null;
    rrfScore: number | null;
    hop: number;
    linkedFrom: string[];
  };

  const results: ResultEntry[] = [];
  const seedIdToPath = new Map(seedResults.map((r) => [r.id, r.path]));

  for (const r of seedResults) {
    results.push({
      id: r.id,
      path: r.path,
      title: r.title,
      section: r.section,
      docType: r.doc_type,
      docStatus: r.doc_status,
      tags: r.tags,
      wordCount: r.word_count,
      score: Number(r.rrf_score) / maxRrf, // normalize to 0-1
      source: "seed",
      similarity: r.similarity != null ? Number(r.similarity) : null,
      rrfScore: Number(r.rrf_score),
      hop: 0,
      linkedFrom: [],
    });
  }

  // Add graph neighbors with blended score
  for (const r of neighborDocs) {
    const meta = neighborMap.get(r.id);
    if (!meta) continue;

    const sim = Number(r.similarity);
    const graphProximity = meta.minHop === 1 ? 0.8 : 0.5;
    const connectionDensity = Math.min(meta.seedIds.length / seeds, 1);
    // Blend: 50% similarity + 30% graph proximity + 20% connection density
    const score = sim * 0.5 + graphProximity * 0.3 + connectionDensity * 0.2;

    results.push({
      id: r.id,
      path: r.path,
      title: r.title,
      section: r.section,
      docType: r.doc_type,
      docStatus: r.doc_status,
      tags: r.tags,
      wordCount: r.word_count,
      score,
      source: "graph",
      similarity: sim,
      rrfScore: null,
      hop: meta.minHop,
      linkedFrom: meta.seedIds
        .map((id) => seedIdToPath.get(id))
        .filter(Boolean) as string[],
    });
  }

  // Sort by score descending, take top N
  results.sort((a, b) => b.score - a.score);
  const finalResults = results.slice(0, limit);

  // Build graph summary
  const graphEdges: Array<{ from: string; to: string; hop: number }> = [];
  const includedPaths = new Set(finalResults.map((r) => r.path));

  for (const r of finalResults) {
    if (r.source === "graph") {
      for (const from of r.linkedFrom) {
        if (includedPaths.has(from)) {
          graphEdges.push({ from, to: r.path, hop: r.hop });
        }
      }
    }
  }

  return {
    query: q,
    mode: "graphrag",
    depth,
    seeds: seedResults.length,
    count: finalResults.length,
    results: finalResults.map((r) => ({
      path: r.path,
      title: r.title,
      section: r.section,
      docType: r.docType,
      docStatus: r.docStatus,
      tags: r.tags,
      wordCount: r.wordCount,
      score: Math.round(r.score * 1000) / 1000,
      source: r.source,
      similarity:
        r.similarity != null ? Math.round(r.similarity * 1000) / 1000 : null,
      hop: r.hop,
      linkedFrom: r.linkedFrom,
    })),
    graph: {
      nodes: includedPaths.size,
      edges: graphEdges,
    },
  };
});
