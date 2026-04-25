import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client-tenant";
import { generateEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { resolveBrainIds, isBrainError } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

export const GET = authedTenantRoute(async ({ req, tx, principal }) => {
  const brains = await resolveBrainIds(tx, req, principal);
  if (isBrainError(brains)) return brains;
  const brainIds = brains.map((b) => b.brainId);
  const nameById = new Map(brains.map((b) => [b.brainId, b.brainName]));

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
  const mode = url.searchParams.get("mode") || "hybrid";
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "20", 10),
    100,
  );
  const threshold = parseFloat(url.searchParams.get("threshold") || "0.0");

  // Voyage is asymmetric: queries must use input_type="query"; indexed chunks
  // use "document".
  const queryEmbedding = await generateEmbedding(q, "query");
  const vectorLiteral = toVectorLiteral(queryEmbedding);

  if (mode === "vector") {
    const filters: Prisma.Sql[] = [
      Prisma.sql`embedding IS NOT NULL`,
      Prisma.sql`brain_id = ANY(${brainIds}::text[])`,
    ];
    if (section) filters.push(Prisma.sql`section = ${section}`);
    if (docType) filters.push(Prisma.sql`doc_type = ${docType}`);
    const where = Prisma.join(filters, " AND ");

    const results = await tx.$queryRaw<
      Array<{
        id: string;
        path: string;
        title: string;
        section: string;
        doc_type: string | null;
        doc_status: string | null;
        tags: string[];
        word_count: number;
        source_type: string;
        brain_id: string;
        similarity: number;
      }>
    >`
      SELECT id, path, title, section, doc_type, doc_status, tags, word_count,
             'document' AS source_type, brain_id,
             1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM vault_documents
      WHERE ${where}
        AND 1 - (embedding <=> ${vectorLiteral}::vector) > ${threshold}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;

    return {
      query: q,
      mode,
      brains: brains.map((b) => b.brainName),
      count: results.length,
      results: results.map((r) => ({
        id: r.id,
        path: r.path,
        title: r.title,
        section: r.section,
        docType: r.doc_type,
        docStatus: r.doc_status,
        tags: r.tags,
        wordCount: r.word_count,
        sourceType: r.source_type,
        brain: nameById.get(r.brain_id) ?? null,
        similarity: Number(r.similarity),
      })),
    };
  }

  // Hybrid mode: RRF over FTS + vector. The WHERE clauses below already scope
  // every candidate to the requested brain set, so the fusion is natively
  // cross-brain and produces one comparable ranking across all inputs.
  const k = 60;

  const filters: Prisma.Sql[] = [
    Prisma.sql`brain_id = ANY(${brainIds}::text[])`,
  ];
  if (section) filters.push(Prisma.sql`section = ${section}`);
  if (docType) filters.push(Prisma.sql`doc_type = ${docType}`);
  const filterClause = Prisma.sql`AND ${Prisma.join(filters, " AND ")}`;

  const results = await tx.$queryRaw<
    Array<{
      id: string;
      path: string;
      title: string;
      section: string;
      doc_type: string | null;
      doc_status: string | null;
      tags: string[];
      word_count: number;
      source_type: string;
      brain_id: string;
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
           d.tags, d.word_count, 'document' AS source_type, d.brain_id,
           c.similarity, c.fts_rank, c.rrf_score
    FROM combined c
    JOIN vault_documents d ON d.id = c.id
    ORDER BY c.rrf_score DESC
    LIMIT ${limit}
  `;

  return {
    query: q,
    mode,
    brains: brains.map((b) => b.brainName),
    count: results.length,
    results: results.map((r) => ({
      id: r.id,
      path: r.path,
      title: r.title,
      section: r.section,
      docType: r.doc_type,
      docStatus: r.doc_status,
      tags: r.tags,
      wordCount: r.word_count,
      sourceType: r.source_type,
      brain: nameById.get(r.brain_id) ?? null,
      similarity: r.similarity != null ? Number(r.similarity) : null,
      ftsRank: r.fts_rank != null ? Number(r.fts_rank) : null,
      rrfScore: Number(r.rrf_score),
    })),
  };
});
