import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client-tenant";
import { resolveBrainIds, isBrainError } from "@/lib/vault";
import {
  buildValidationSqlFilter,
  buildValidationBoostExpr,
  makeValidationBlock,
  type ValidationBlock,
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

  // No accessible brains in scope → no results without round-tripping. Hits
  // when ?brain=all is passed by a user with zero BrainAccess rows.
  if (brainIds.length === 0) {
    return { query: q, brains: [], count: 0, results: [] };
  }

  const section = url.searchParams.get("section");
  const docType = url.searchParams.get("type");
  const docStatus = url.searchParams.get("status");
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "20", 10),
    100,
  );

  // Validation flags (see src/lib/vault/validation-filter.ts).
  const validationOpts: ValidationFilterOpts = parseValidationFlags(url);
  const validationFilter = buildValidationSqlFilter(validationOpts);
  const boostExpr = buildValidationBoostExpr();

  const filters: Prisma.Sql[] = [
    Prisma.sql`search_vector @@ websearch_to_tsquery('english', ${q})`,
    Prisma.sql`brain_id = ANY(${brainIds}::text[])`,
  ];
  if (section) filters.push(Prisma.sql`section = ${section}`);
  if (docType) filters.push(Prisma.sql`doc_type = ${docType}`);
  if (docStatus) filters.push(Prisma.sql`doc_status = ${docStatus}`);
  const docWhere = Prisma.join(filters, " AND ");

  const hasDocFilters = !!(section || docType || docStatus);

  // Files leg drops out when the request filters on doc-only columns
  // (section / doc_type / doc_status) — those columns don't exist on
  // vault_files, so the UNION would either error or silently exclude.
  // Files don't carry validation metadata; they're returned without
  // boost/filter and with a null validation block on the client side.
  const filesUnion = hasDocFilters
    ? Prisma.empty
    : Prisma.sql`
        UNION ALL

        SELECT id, s3_key AS path, filename AS title, category AS section,
               NULL AS doc_type, NULL AS doc_status, tags, 0 AS word_count,
               'file' AS source_type, mime_type, brain_id,
               ts_rank(search_vector, websearch_to_tsquery('english', ${q})) AS rank,
               ts_headline('english', extracted_text, websearch_to_tsquery('english', ${q}),
                 'StartSel=<<, StopSel=>>, MaxWords=60, MinWords=20, MaxFragments=3'
               ) AS snippet,
               NULL AS validation_status,
               NULL AS provenance,
               NULL::timestamp AS validated_at,
               NULL AS validated_by
        FROM vault_files
        WHERE search_vector @@ websearch_to_tsquery('english', ${q})
          AND extracted_text IS NOT NULL
          AND brain_id = ANY(${brainIds}::text[])`;

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
      mime_type: string | null;
      brain_id: string;
      rank: number;
      snippet: string;
      validation_status: string | null;
      provenance: string | null;
      validated_at: Date | null;
      validated_by: string | null;
    }>
  >`
    SELECT
      id, path, title, section, doc_type, doc_status, tags, word_count,
      'document' AS source_type, NULL AS mime_type, brain_id,
      ts_rank(search_vector, websearch_to_tsquery('english', ${q})) + ${boostExpr} AS rank,
      ts_headline('english', content, websearch_to_tsquery('english', ${q}),
        'StartSel=<<, StopSel=>>, MaxWords=60, MinWords=20, MaxFragments=3'
      ) AS snippet,
      validation_status, provenance, validated_at, validated_by
    FROM vault_documents
    WHERE ${docWhere}${validationFilter}
    ${filesUnion}
    ORDER BY rank DESC
    LIMIT ${limit}
  `;

  return {
    query: q,
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
      mimeType: r.mime_type,
      brain: nameById.get(r.brain_id) ?? null,
      rank: r.rank,
      snippet: r.snippet,
      validation: r.source_type === "document"
        ? (makeValidationBlock(r) as ValidationBlock)
        : null,
    })),
  };
});

/**
 * Read validation flags from the URL into the shared ValidationFilterOpts
 * shape. Default behavior matches the spec: exclude `disqualified`, keep
 * `stale` in results.
 */
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
