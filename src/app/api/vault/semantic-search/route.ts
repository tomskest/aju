import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client-tenant";
import { generateEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { resolveBrainIds, isBrainError } from "@/lib/vault";
import {
  buildValidationSqlFilter,
  makeValidationBlock,
  DEFAULT_RANK_WEIGHTS,
  type ValidationFilterOpts,
} from "@/lib/vault/validation-filter";
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

  // No accessible brains in scope → return early. Avoids one DB round-trip
  // (and a Voyage embedding call) for the zero-access ?brain=all case.
  if (brainIds.length === 0) {
    return { query: q, brains: [], count: 0, results: [] };
  }

  const section = url.searchParams.get("section");
  const docType = url.searchParams.get("type");
  const mode = url.searchParams.get("mode") || "hybrid";
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "20", 10),
    100,
  );
  const threshold = parseFloat(url.searchParams.get("threshold") || "0.0");

  const validationOpts: ValidationFilterOpts = parseValidationFlags(url);
  const validationFilter = buildValidationSqlFilter(validationOpts);
  const w = DEFAULT_RANK_WEIGHTS;

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

    // HNSW preservation: the inner SELECT scans + orders by `embedding <=>
    // vec` so the index actually serves the order. Adding a CASE expression
    // to that ORDER BY would force a sequential scan on the entire brain.
    // Outer SELECT applies the boost to the candidate window (top 100) and
    // re-sorts.
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
        final_score: number;
        validation_status: string;
        provenance: string;
        validated_at: Date | null;
        validated_by: string | null;
      }>
    >`
      SELECT * FROM (
        SELECT id, path, title, section, doc_type, doc_status, tags, word_count,
               'document' AS source_type, brain_id,
               1 - (embedding <=> ${vectorLiteral}::vector) AS similarity,
               (1 - (embedding <=> ${vectorLiteral}::vector)) + (
                 CASE
                   WHEN validation_status = 'validated' THEN ${w.validated}
                   WHEN validation_status = 'stale' THEN ${w.stale}
                   ELSE 0
                 END
                 + CASE WHEN provenance = 'human' THEN ${w.human} ELSE 0 END
               ) AS final_score,
               validation_status, provenance, validated_at, validated_by
        FROM vault_documents
        WHERE ${where}${validationFilter}
          AND 1 - (embedding <=> ${vectorLiteral}::vector) > ${threshold}
        ORDER BY embedding <=> ${vectorLiteral}::vector
        LIMIT 100
      ) candidates
      ORDER BY final_score DESC
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
        score: Number(r.final_score),
        validation: makeValidationBlock(r),
      })),
    };
  }

  // Hybrid mode: RRF over FTS + vector. Validation filter applies to BOTH
  // candidate CTEs so disqualified docs never enter the candidate pool.
  // Boost is applied post-normalization (rrf_score / max_rrf) so the
  // magnitude is comparable to the boost weights (~0.05–0.10).
  const k = 60;

  const filters: Prisma.Sql[] = [
    Prisma.sql`brain_id = ANY(${brainIds}::text[])`,
  ];
  if (section) filters.push(Prisma.sql`section = ${section}`);
  if (docType) filters.push(Prisma.sql`doc_type = ${docType}`);
  const filterClause = Prisma.sql`AND ${Prisma.join(filters, " AND ")}${validationFilter}`;

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
      final_score: number;
      validation_status: string;
      provenance: string;
      validated_at: Date | null;
      validated_by: string | null;
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
    ),
    max_rrf AS (
      SELECT GREATEST(MAX(rrf_score), 1e-9) AS m FROM combined
    )
    SELECT d.id, d.path, d.title, d.section, d.doc_type, d.doc_status,
           d.tags, d.word_count, 'document' AS source_type, d.brain_id,
           c.similarity, c.fts_rank, c.rrf_score,
           (c.rrf_score / mr.m) + (
             CASE
               WHEN d.validation_status = 'validated' THEN ${w.validated}
               WHEN d.validation_status = 'stale' THEN ${w.stale}
               ELSE 0
             END
             + CASE WHEN d.provenance = 'human' THEN ${w.human} ELSE 0 END
           ) AS final_score,
           d.validation_status, d.provenance, d.validated_at, d.validated_by
    FROM combined c
    JOIN vault_documents d ON d.id = c.id
    CROSS JOIN max_rrf mr
    ORDER BY final_score DESC
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
      score: Number(r.final_score),
      validation: makeValidationBlock(r),
    })),
  };
});

function parseValidationFlags(url: URL): ValidationFilterOpts {
  const facts = url.searchParams.get("facts");
  const includeStale = url.searchParams.get("includeStale");
  const includeDisq = url.searchParams.get("includeDisqualified");
  const provenance = url.searchParams.get("provenance");

  const opts: ValidationFilterOpts = {};
  if (facts === "1" || facts === "true") opts.factsOnly = true;
  if (includeStale === "0" || includeStale === "false")
    opts.includeStale = false;
  if (includeDisq === "1" || includeDisq === "true")
    opts.includeDisqualified = true;
  if (provenance === "human" || provenance === "agent" || provenance === "ingested")
    opts.provenance = provenance;
  return opts;
}
