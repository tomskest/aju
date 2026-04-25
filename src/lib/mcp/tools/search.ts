/**
 * Search & graph-traversal MCP tools — keyword / semantic / backlinks /
 * related. Each call scopes to the caller's tenant DB via `withTenant` and
 * then resolves one or more brains before running the actual query.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Prisma } from "@prisma/client-tenant";
import { z } from "zod";
import { generateEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { withTenant } from "@/lib/tenant";
import {
  type McpToolContext,
  errorResult,
  requireOrgId,
  resolveBrainForTool,
  resolveBrainsForTool,
  textResult,
} from "./shared";

export function registerSearchTools(
  server: McpServer,
  ctx: McpToolContext,
): void {
  // ── aju_search ──────────────────────────────────────
  server.tool(
    "aju_search",
    "Full-text search across one or more aju brains (memory, notes, vault, knowledge base, archive, journal). Use this to find documents by keywords. Returns ranked results with snippets. Pass a single brain name, an array, or 'all' to span every accessible brain.",
    {
      query: z.string().describe("Search query (supports natural language and boolean terms)"),
      brain: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Brain to search. Accepts a single name, an array of names, 'all' for every accessible brain, or a comma-separated list ('a,b'). Omit for the default brain.",
        ),
      section: z
        .string()
        .optional()
        .describe("Optional: filter by top-level section / directory prefix."),
      limit: z
        .number()
        .optional()
        .describe("Max results (default 20, max 100)."),
    },
    async ({ query, brain, section, limit }) => {
      try {
        const organizationId = requireOrgId(ctx);
        return await withTenant(
          { organizationId, userId: ctx.userId, agentId: ctx.agentId },
          async ({ tx }) => {
            const brains = await resolveBrainsForTool(tx, ctx, brain);
            const brainIds = brains.map((b) => b.brainId);
            const nameById = new Map(brains.map((b) => [b.brainId, b.brainName]));
            const max = Math.min(limit ?? 20, 100);

            const filters: Prisma.Sql[] = [
              Prisma.sql`search_vector @@ websearch_to_tsquery('english', ${query})`,
              Prisma.sql`brain_id = ANY(${brainIds}::text[])`,
            ];
            if (section) filters.push(Prisma.sql`section = ${section}`);
            const where = Prisma.join(filters, " AND ");

            const results = await tx.$queryRaw<
              Array<{
                path: string;
                title: string;
                section: string;
                brain_id: string;
                rank: number;
                snippet: string;
              }>
            >`
              SELECT path, title, section, brain_id,
                     ts_rank(search_vector, websearch_to_tsquery('english', ${query})) AS rank,
                     ts_headline('english', content, websearch_to_tsquery('english', ${query}),
                       'StartSel=<<, StopSel=>>, MaxWords=50, MinWords=15, MaxFragments=2'
                     ) AS snippet
              FROM vault_documents
              WHERE ${where}
              ORDER BY rank DESC
              LIMIT ${max}
            `;

            return textResult({
              brains: brains.map((b) => b.brainName),
              query,
              count: results.length,
              results: results.map((r) => ({
                brain: nameById.get(r.brain_id) ?? null,
                path: r.path,
                title: r.title,
                section: r.section,
                score: Number(r.rank),
                snippet: r.snippet,
              })),
            });
          },
        );
      } catch (err) {
        return errorResult(String(err instanceof Error ? err.message : err));
      }
    },
  );

  // ── aju_semantic_search ─────────────────────────────
  server.tool(
    "aju_semantic_search",
    "Semantic search across one or more aju brains using AI embeddings. Finds conceptually related memories / notes even when exact keywords don't match. Use when the user asks you to recall something 'about' a topic or 'like' another thing. Pass a single brain name, an array, or 'all' to span every accessible brain — hybrid mode fuses candidates across brains in one RRF pass so scores are comparable.",
    {
      query: z.string().describe("Natural-language query."),
      brain: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Brain to search. Accepts a single name, an array of names, 'all' for every accessible brain, or a comma-separated list ('a,b'). Omit for the default brain.",
        ),
      mode: z
        .enum(["hybrid", "vector"])
        .optional()
        .describe("Ranking mode: 'hybrid' (default, FTS + vector RRF) or 'vector' (pure semantic)."),
      limit: z.number().optional().describe("Max results (default 20, max 100)."),
    },
    async ({ query, brain, mode, limit }) => {
      try {
        const organizationId = requireOrgId(ctx);
        return await withTenant(
          { organizationId, userId: ctx.userId, agentId: ctx.agentId },
          async ({ tx }) => {
            const brains = await resolveBrainsForTool(tx, ctx, brain);
            const brainIds = brains.map((b) => b.brainId);
            const nameById = new Map(brains.map((b) => [b.brainId, b.brainName]));
            const max = Math.min(limit ?? 20, 100);
            const m = mode ?? "hybrid";

            const queryEmbedding = await generateEmbedding(query, "query");
            const vector = toVectorLiteral(queryEmbedding);

            if (m === "vector") {
              const results = await tx.$queryRaw<
                Array<{
                  path: string;
                  title: string;
                  section: string;
                  brain_id: string;
                  similarity: number;
                }>
              >`
                SELECT path, title, section, brain_id,
                       1 - (embedding <=> ${vector}::vector) AS similarity
                FROM vault_documents
                WHERE embedding IS NOT NULL AND brain_id = ANY(${brainIds}::text[])
                ORDER BY embedding <=> ${vector}::vector
                LIMIT ${max}
              `;
              return textResult({
                brains: brains.map((b) => b.brainName),
                query,
                mode: m,
                count: results.length,
                results: results.map((r) => ({
                  brain: nameById.get(r.brain_id) ?? null,
                  path: r.path,
                  title: r.title,
                  section: r.section,
                  similarity: Number(r.similarity),
                })),
              });
            }

            // hybrid — RRF of FTS + vector, k = 60. The WHERE clauses below scope
            // every candidate to the requested brain set, so the fusion is
            // natively cross-brain and produces one comparable ranking.
            const k = 60;
            const results = await tx.$queryRaw<
              Array<{
                path: string;
                title: string;
                section: string;
                brain_id: string;
                similarity: number | null;
                fts_rank: number | null;
                rrf_score: number;
              }>
            >`
              WITH vector_results AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${vector}::vector) AS vec_rank,
                       1 - (embedding <=> ${vector}::vector) AS similarity
                FROM vault_documents
                WHERE embedding IS NOT NULL AND brain_id = ANY(${brainIds}::text[])
                ORDER BY embedding <=> ${vector}::vector
                LIMIT 100
              ),
              fts_results AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', ${query})) DESC) AS fts_rank,
                       ts_rank(search_vector, websearch_to_tsquery('english', ${query})) AS fts_score
                FROM vault_documents
                WHERE search_vector @@ websearch_to_tsquery('english', ${query}) AND brain_id = ANY(${brainIds}::text[])
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
              SELECT d.path, d.title, d.section, d.brain_id,
                     c.similarity, c.fts_rank, c.rrf_score
              FROM combined c
              JOIN vault_documents d ON d.id = c.id
              ORDER BY c.rrf_score DESC
              LIMIT ${max}
            `;
            return textResult({
              brains: brains.map((b) => b.brainName),
              query,
              mode: m,
              count: results.length,
              results: results.map((r) => ({
                brain: nameById.get(r.brain_id) ?? null,
                path: r.path,
                title: r.title,
                section: r.section,
                similarity: r.similarity != null ? Number(r.similarity) : null,
                rrfScore: Number(r.rrf_score),
              })),
            });
          },
        );
      } catch (err) {
        return errorResult(String(err instanceof Error ? err.message : err));
      }
    },
  );

  // ── aju_backlinks ───────────────────────────────────
  server.tool(
    "aju_backlinks",
    "Find all documents in an aju brain that link TO a given document (backlinks). Use this to see what other memories / notes reference a given thought.",
    {
      path: z.string().describe("Target document path."),
      brain: z.string().optional().describe("Brain name. Omit for default."),
    },
    async ({ path, brain }) => {
      try {
        const organizationId = requireOrgId(ctx);
        return await withTenant(
          { organizationId, userId: ctx.userId, agentId: ctx.agentId },
          async ({ tx }) => {
            const b = await resolveBrainForTool(tx, ctx, brain);
            const doc = await tx.vaultDocument.findFirst({
              where: { brainId: b.brainId, path },
              select: { id: true },
            });
            if (!doc) return errorResult(`Document not found: ${path}`);

            const links = await tx.documentLink.findMany({
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
            return textResult({
              brain: b.brainName,
              path,
              count: links.length,
              backlinks: links.map((l) => ({
                linkText: l.linkText,
                path: l.source.path,
                title: l.source.title,
                section: l.source.section,
                docType: l.source.docType,
                tags: l.source.tags,
              })),
            });
          },
        );
      } catch (err) {
        return errorResult(String(err instanceof Error ? err.message : err));
      }
    },
  );

  // ── aju_related ─────────────────────────────────────
  server.tool(
    "aju_related",
    "Find documents related to a given document via outgoing links, incoming links (backlinks), and shared tags. Deduplicates across all three sources.",
    {
      path: z.string().describe("Source document path."),
      brain: z.string().optional().describe("Brain name. Omit for default."),
      limit: z.number().optional().describe("Max related documents (default 50)."),
    },
    async ({ path, brain, limit }) => {
      try {
        const organizationId = requireOrgId(ctx);
        return await withTenant(
          { organizationId, userId: ctx.userId, agentId: ctx.agentId },
          async ({ tx }) => {
            const b = await resolveBrainForTool(tx, ctx, brain);
            const max = Math.min(limit ?? 50, 200);

            const doc = await tx.vaultDocument.findFirst({
              where: { brainId: b.brainId, path },
              select: { id: true, tags: true },
            });
            if (!doc) return errorResult(`Document not found: ${path}`);

            const [outgoing, incoming] = await Promise.all([
              tx.documentLink.findMany({
                where: { sourceId: doc.id },
                include: {
                  target: {
                    select: { path: true, title: true, section: true, docType: true, tags: true },
                  },
                },
              }),
              tx.documentLink.findMany({
                where: { targetId: doc.id },
                include: {
                  source: {
                    select: { path: true, title: true, section: true, docType: true, tags: true },
                  },
                },
              }),
            ]);

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
                  AND brain_id = ${b.brainId}
                  AND tags && ${doc.tags}::text[]
                ORDER BY shared_tags DESC
                LIMIT 20
              `;
            }

            const seen = new Set<string>();
            const related: Array<{
              path: string;
              title: string;
              section: string;
              docType: string | null;
              relationship: string;
            }> = [];
            for (const l of outgoing) {
              if (seen.has(l.target.path)) continue;
              seen.add(l.target.path);
              related.push({
                path: l.target.path,
                title: l.target.title,
                section: l.target.section,
                docType: l.target.docType,
                relationship: "outgoing_link",
              });
            }
            for (const l of incoming) {
              if (seen.has(l.source.path)) continue;
              seen.add(l.source.path);
              related.push({
                path: l.source.path,
                title: l.source.title,
                section: l.source.section,
                docType: l.source.docType,
                relationship: "incoming_link",
              });
            }
            for (const n of tagNeighbors) {
              if (seen.has(n.path)) continue;
              seen.add(n.path);
              related.push({
                path: n.path,
                title: n.title,
                section: n.section,
                docType: n.doc_type,
                relationship: `tag_neighbor (${n.shared_tags} shared)`,
              });
            }

            return textResult({
              brain: b.brainName,
              path,
              count: Math.min(related.length, max),
              related: related.slice(0, max),
            });
          },
        );
      } catch (err) {
        return errorResult(String(err instanceof Error ? err.message : err));
      }
    },
  );
}
