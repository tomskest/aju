/**
 * Tool layer for the aju Tag agent loop.
 *
 * Thin adapters over the same vault/search libs the MCP tools use — the MCP
 * modules themselves are deliberately NOT touched (spec §8.3). Every tool
 * executes inside withTenant({organizationId, agentId}), so reads are pinned
 * to the agent's BrainAccess grants by Postgres RLS: an out-of-scope read
 * fails at the database, not at the prompt layer.
 *
 * Write policy: `capture` writes ONLY to the binding's primary brain, with
 * provenance "agent" and validationStatus "unvalidated" (the existing
 * validation lifecycle is the human-review loop). There is no delete tool
 * in any phase.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client-tenant";
import type { Prisma as PrismaTenant } from "@prisma/client-tenant";
import { z } from "zod";
import { withTenant } from "@/lib/tenant";
import { parseDocument, scheduleRebuildLinks, threeWayMerge } from "@/lib/vault";
import { buildValidationSqlFilter, DEFAULT_RANK_WEIGHTS } from "@/lib/vault/validation-filter";
import { generateEmbedding, toVectorLiteral, updateDocumentEmbedding } from "@/lib/embeddings";
import { vaultPathSchema } from "@/lib/validators";

type TenantTx = PrismaTenant.TransactionClient;

export type AgentToolContext = {
  organizationId: string;
  /** Tenant-side Agent id — the channel's identity. RLS scopes to its grants. */
  agentId: string;
  /** Changelog/version attribution, e.g. `agent:<id>`. */
  identity: string;
  primaryBrainId: string;
  primaryBrainName: string;
};

export class AgentToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentToolError";
  }
}

const MAX_READ_CHARS = 20_000;
const VERSION_SOURCE = "slack";

// ─── Tool definitions ───────────────────────────────────────────────────────

export const DEFAULT_TOOL_NAMES = [
  "search",
  "semantic_search",
  "read",
  "browse",
  "capture",
  "append_or_update",
] as const;

export type AgentToolName = (typeof DEFAULT_TOOL_NAMES)[number];

/**
 * Resolve the effective tool set for a binding. `toolPolicy` (a JSON array
 * of tool names on the binding) can only NARROW the default set — unknown
 * names are ignored, and it can never widen beyond DEFAULT_TOOL_NAMES.
 */
export function allowedToolNames(toolPolicy: unknown): AgentToolName[] {
  if (!Array.isArray(toolPolicy)) return [...DEFAULT_TOOL_NAMES];
  const requested = new Set(toolPolicy.filter((t) => typeof t === "string"));
  const narrowed = DEFAULT_TOOL_NAMES.filter((t) => requested.has(t));
  return narrowed.length > 0 ? narrowed : [...DEFAULT_TOOL_NAMES];
}

export function agentToolDefinitions(allowed: readonly AgentToolName[]): Anthropic.Tool[] {
  const defs: Record<AgentToolName, Anthropic.Tool> = {
    search: {
      name: "search",
      description:
        "Full-text keyword search across every brain this channel's agent can read. Use for exact terms, names, and phrases. Returns paths, titles, snippets, and validation status.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (keywords)." },
          limit: { type: "number", description: "Max results, default 10." },
        },
        required: ["query"],
      },
    },
    semantic_search: {
      name: "semantic_search",
      description:
        "Hybrid semantic search (embeddings + keyword fusion) across readable brains. Use when the question is conceptual and exact keywords may not match. Call this before answering any 'what do we know about X' question.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language query." },
          limit: { type: "number", description: "Max results, default 10." },
        },
        required: ["query"],
      },
    },
    read: {
      name: "read",
      description:
        "Read one document by path. Returns full markdown content plus metadata and contentHash (pass contentHash back as baseHash when updating).",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Document path." },
          brain: {
            type: "string",
            description: "Brain name. Omit for the channel's primary brain.",
          },
        },
        required: ["path"],
      },
    },
    browse: {
      name: "browse",
      description:
        "List documents under a directory prefix (metadata only). Use to check whether a capture for a thread already exists under slack/<channel>/.",
      input_schema: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description: "Directory prefix, e.g. 'slack/general'. Omit for all.",
          },
          brain: {
            type: "string",
            description: "Brain name. Omit for the channel's primary brain.",
          },
        },
        required: [],
      },
    },
    capture: {
      name: "capture",
      description:
        "Create a NEW memory document in the channel's primary brain. Call this when asked to remember/save something. Content must follow the capture conventions (frontmatter, summary first, '## Raw thread' with verbatim messages). Fails if the path already exists — use append_or_update then.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Document path, e.g. 'slack/general/2026-07-03-pricing-decision-1234.5678.md'.",
          },
          content: {
            type: "string",
            description: "Full markdown including frontmatter.",
          },
        },
        required: ["path", "content"],
      },
    },
    append_or_update: {
      name: "append_or_update",
      description:
        "Replace the full content of an EXISTING document in the channel's primary brain. Read it first and pass its contentHash as baseHash (plus baseContent) so concurrent edits merge safely.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Existing document path." },
          content: { type: "string", description: "Full replacement markdown." },
          baseHash: {
            type: "string",
            description: "contentHash from your read (sha256 hex).",
          },
          baseContent: {
            type: "string",
            description: "Exact content you read, for three-way merge.",
          },
        },
        required: ["path", "content"],
      },
    },
  };
  return allowed.map((name) => defs[name]);
}

// ─── Execution ──────────────────────────────────────────────────────────────

const searchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});
const readInput = z.object({ path: z.string().min(1), brain: z.string().optional() });
const browseInput = z.object({
  directory: z.string().optional(),
  brain: z.string().optional(),
});
const captureInput = z.object({ path: vaultPathSchema, content: z.string().min(1) });
const updateInput = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
  baseHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  baseContent: z.string().optional(),
});

/**
 * Execute one tool call and return a JSON string for the tool_result block.
 * Throws AgentToolError for model-recoverable failures (the loop converts
 * these to is_error tool results so the model can re-plan).
 */
export async function executeAgentTool(
  ctx: AgentToolContext,
  allowed: readonly AgentToolName[],
  name: string,
  input: unknown,
): Promise<string> {
  if (!allowed.includes(name as AgentToolName)) {
    throw new AgentToolError(`Tool not permitted in this channel: ${name}`);
  }
  switch (name as AgentToolName) {
    case "search":
      return toolSearch(ctx, searchInput.parse(input));
    case "semantic_search":
      return toolSemanticSearch(ctx, searchInput.parse(input));
    case "read":
      return toolRead(ctx, readInput.parse(input));
    case "browse":
      return toolBrowse(ctx, browseInput.parse(input));
    case "capture":
      return toolCapture(ctx, captureInput.parse(input));
    case "append_or_update":
      return toolUpdate(ctx, updateInput.parse(input));
  }
}

/** Resolve a brain by name against the AGENT's grants (never the org's). */
async function resolveGrantedBrain(
  tx: TenantTx,
  ctx: AgentToolContext,
  requested?: string,
): Promise<{ brainId: string; brainName: string; role: string }> {
  const wanted = requested ?? ctx.primaryBrainName;
  const access = await tx.brainAccess.findFirst({
    where: { agentId: ctx.agentId, brain: { name: wanted } },
    include: { brain: true },
  });
  if (!access) {
    throw new AgentToolError(`Brain not found or not granted: ${wanted}`);
  }
  return {
    brainId: access.brain.id,
    brainName: access.brain.name,
    role: access.role,
  };
}

async function toolSearch(
  ctx: AgentToolContext,
  input: z.infer<typeof searchInput>,
): Promise<string> {
  return withTenant(
    { organizationId: ctx.organizationId, agentId: ctx.agentId },
    async ({ tx, brainIds }) => {
      const max = Math.min(input.limit ?? 10, 50);
      const validationFilter = buildValidationSqlFilter({});
      const w = DEFAULT_RANK_WEIGHTS;
      const results = await tx.$queryRaw<
        Array<{
          path: string;
          title: string;
          brain_id: string;
          rank: number;
          snippet: string;
          validation_status: string;
          provenance: string;
        }>
      >`
        SELECT path, title, brain_id,
               ts_rank(search_vector, websearch_to_tsquery('english', ${input.query})) + (
                 CASE
                   WHEN validation_status = 'validated' THEN ${w.validated}
                   WHEN validation_status = 'stale' THEN ${w.stale}
                   ELSE 0
                 END
                 + CASE WHEN provenance = 'human' THEN ${w.human} ELSE 0 END
               ) AS rank,
               ts_headline('english', content, websearch_to_tsquery('english', ${input.query}),
                 'StartSel=<<, StopSel=>>, MaxWords=40, MinWords=10, MaxFragments=2'
               ) AS snippet,
               validation_status, provenance
        FROM vault_documents
        WHERE search_vector @@ websearch_to_tsquery('english', ${input.query})
          AND brain_id = ANY(${[...brainIds]}::text[])${validationFilter}
        ORDER BY rank DESC
        LIMIT ${max}
      `;
      const names = await brainNamesById(
        tx,
        results.map((r) => r.brain_id),
      );
      return JSON.stringify({
        count: results.length,
        results: results.map((r) => ({
          brain: names.get(r.brain_id) ?? null,
          path: r.path,
          title: r.title,
          snippet: r.snippet,
          validation: r.validation_status,
          provenance: r.provenance,
        })),
      });
    },
  );
}

async function toolSemanticSearch(
  ctx: AgentToolContext,
  input: z.infer<typeof searchInput>,
): Promise<string> {
  const queryEmbedding = await generateEmbedding(input.query, "query");
  const vector = toVectorLiteral(queryEmbedding);
  return withTenant(
    { organizationId: ctx.organizationId, agentId: ctx.agentId },
    async ({ tx, brainIds }) => {
      const max = Math.min(input.limit ?? 10, 50);
      const validationFilter = buildValidationSqlFilter({});
      const w = DEFAULT_RANK_WEIGHTS;
      const k = 60;
      // Hybrid RRF, mirroring the MCP aju_semantic_search default mode.
      const results = await tx.$queryRaw<
        Array<{
          path: string;
          title: string;
          brain_id: string;
          final_score: number;
          validation_status: string;
          provenance: string;
        }>
      >`
        WITH vector_results AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${vector}::vector) AS vec_rank
          FROM vault_documents
          WHERE embedding IS NOT NULL
            AND brain_id = ANY(${[...brainIds]}::text[])${validationFilter}
          ORDER BY embedding <=> ${vector}::vector
          LIMIT 100
        ),
        fts_results AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', ${input.query})) DESC) AS fts_rank
          FROM vault_documents
          WHERE search_vector @@ websearch_to_tsquery('english', ${input.query})
            AND brain_id = ANY(${[...brainIds]}::text[])${validationFilter}
          LIMIT 100
        ),
        combined AS (
          SELECT COALESCE(v.id, f.id) AS id,
                 COALESCE(1.0 / (${k} + v.vec_rank), 0) + COALESCE(1.0 / (${k} + f.fts_rank), 0) AS rrf_score
          FROM vector_results v
          FULL OUTER JOIN fts_results f ON v.id = f.id
        ),
        max_rrf AS (
          SELECT GREATEST(MAX(rrf_score), 1e-9) AS m FROM combined
        )
        SELECT d.path, d.title, d.brain_id,
               (c.rrf_score / mr.m) + (
                 CASE
                   WHEN d.validation_status = 'validated' THEN ${w.validated}
                   WHEN d.validation_status = 'stale' THEN ${w.stale}
                   ELSE 0
                 END
                 + CASE WHEN d.provenance = 'human' THEN ${w.human} ELSE 0 END
               ) AS final_score,
               d.validation_status, d.provenance
        FROM combined c
        JOIN vault_documents d ON d.id = c.id
        CROSS JOIN max_rrf mr
        ORDER BY final_score DESC
        LIMIT ${max}
      `;
      const names = await brainNamesById(
        tx,
        results.map((r) => r.brain_id),
      );
      return JSON.stringify({
        count: results.length,
        results: results.map((r) => ({
          brain: names.get(r.brain_id) ?? null,
          path: r.path,
          title: r.title,
          score: Number(r.final_score),
          validation: r.validation_status,
          provenance: r.provenance,
        })),
      });
    },
  );
}

async function brainNamesById(tx: TenantTx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const brains = await tx.brain.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true },
  });
  return new Map(brains.map((b) => [b.id, b.name]));
}

async function toolRead(ctx: AgentToolContext, input: z.infer<typeof readInput>): Promise<string> {
  return withTenant(
    { organizationId: ctx.organizationId, agentId: ctx.agentId },
    async ({ tx }) => {
      const b = await resolveGrantedBrain(tx, ctx, input.brain);
      const doc = await tx.vaultDocument.findFirst({
        where: { brainId: b.brainId, path: input.path },
        select: {
          path: true,
          title: true,
          docType: true,
          tags: true,
          content: true,
          contentHash: true,
          validationStatus: true,
          provenance: true,
          updatedAt: true,
        },
      });
      if (!doc) throw new AgentToolError(`Document not found: ${input.path}`);
      const truncated = doc.content.length > MAX_READ_CHARS;
      return JSON.stringify({
        brain: b.brainName,
        path: doc.path,
        title: doc.title,
        docType: doc.docType,
        tags: doc.tags,
        validation: doc.validationStatus,
        provenance: doc.provenance,
        updatedAt: doc.updatedAt.toISOString(),
        contentHash: doc.contentHash,
        truncated,
        content: truncated ? `${doc.content.slice(0, MAX_READ_CHARS)}\n…[truncated]` : doc.content,
      });
    },
  );
}

async function toolBrowse(
  ctx: AgentToolContext,
  input: z.infer<typeof browseInput>,
): Promise<string> {
  return withTenant(
    { organizationId: ctx.organizationId, agentId: ctx.agentId },
    async ({ tx }) => {
      const b = await resolveGrantedBrain(tx, ctx, input.brain);
      const where: Prisma.VaultDocumentWhereInput = { brainId: b.brainId };
      if (input.directory) where.directory = input.directory;
      const docs = await tx.vaultDocument.findMany({
        where,
        select: {
          path: true,
          title: true,
          docType: true,
          tags: true,
          updatedAt: true,
        },
        orderBy: { path: "asc" },
        take: 200,
      });
      return JSON.stringify({
        brain: b.brainName,
        directory: input.directory ?? null,
        count: docs.length,
        documents: docs.map((d) => ({
          path: d.path,
          title: d.title,
          docType: d.docType,
          tags: d.tags,
          updatedAt: d.updatedAt.toISOString(),
        })),
      });
    },
  );
}

async function toolCapture(
  ctx: AgentToolContext,
  input: z.infer<typeof captureInput>,
): Promise<string> {
  const { tenant, brainId, docId, path } = await withTenant(
    { organizationId: ctx.organizationId, agentId: ctx.agentId },
    async ({ tenant, tx }) => {
      // Writes go to the primary brain only — never a brain named by input.
      const access = await tx.brainAccess.findFirst({
        where: { agentId: ctx.agentId, brainId: ctx.primaryBrainId },
        select: { role: true },
      });
      if (!access || (access.role !== "editor" && access.role !== "owner")) {
        throw new AgentToolError(`No write access to brain: ${ctx.primaryBrainName}`);
      }
      const existing = await tx.vaultDocument.findFirst({
        where: { brainId: ctx.primaryBrainId, path: input.path },
        select: { id: true },
      });
      if (existing) {
        throw new AgentToolError(`Document already exists: ${input.path} — use append_or_update.`);
      }
      const parsed = parseDocument(input.content, input.path);
      const doc = await tx.vaultDocument.create({
        data: {
          brainId: ctx.primaryBrainId,
          path: input.path,
          title: parsed.title,
          frontmatter: (parsed.frontmatter ?? undefined) as Prisma.InputJsonValue | undefined,
          docType: parsed.docType,
          docStatus: parsed.docStatus,
          tags: parsed.tags,
          content: parsed.content,
          contentHash: parsed.contentHash,
          wordCount: parsed.wordCount,
          directory: parsed.directory,
          section: parsed.section,
          wikilinks: parsed.wikilinks,
          fileModified: new Date(),
          syncedAt: new Date(),
          // Machine-captured memory: visibly agent-authored, human-reviewable.
          provenance: "agent",
          validationStatus: "unvalidated",
        },
      });
      await tx.vaultDocumentVersion.create({
        data: {
          brainId: ctx.primaryBrainId,
          documentId: doc.id,
          path: input.path,
          versionN: 1,
          content: parsed.content,
          contentHash: parsed.contentHash,
          parentHash: null,
          mergeParentHash: null,
          source: VERSION_SOURCE,
          changedBy: ctx.identity,
        },
      });
      await tx.vaultChangeLog.create({
        data: {
          brainId: ctx.primaryBrainId,
          documentId: doc.id,
          path: input.path,
          operation: "insert",
          source: VERSION_SOURCE,
          changedBy: ctx.identity,
        },
      });
      return { tenant, brainId: ctx.primaryBrainId, docId: doc.id, path: doc.path };
    },
  );

  // Same post-commit pipeline as every other write surface: embeddings +
  // link graph. Awaited (the worker has time), failures non-fatal.
  await Promise.allSettled([
    updateDocumentEmbedding(tenant, docId),
    scheduleRebuildLinks(tenant, brainId),
  ]);
  return JSON.stringify({ created: true, brain: ctx.primaryBrainName, path });
}

async function toolUpdate(
  ctx: AgentToolContext,
  input: z.infer<typeof updateInput>,
): Promise<string> {
  const result = await withTenant(
    { organizationId: ctx.organizationId, agentId: ctx.agentId },
    async ({ tenant, tx }) => {
      const access = await tx.brainAccess.findFirst({
        where: { agentId: ctx.agentId, brainId: ctx.primaryBrainId },
        select: { role: true },
      });
      if (!access || (access.role !== "editor" && access.role !== "owner")) {
        throw new AgentToolError(`No write access to brain: ${ctx.primaryBrainName}`);
      }
      const existing = await tx.vaultDocument.findFirst({
        where: { brainId: ctx.primaryBrainId, path: input.path },
        select: { id: true, content: true, contentHash: true },
      });
      if (!existing) {
        throw new AgentToolError(`Document not found: ${input.path}`);
      }

      // CAS + three-way merge, mirroring /api/vault/update and aju_update.
      let resolvedContent = input.content;
      let merged = false;
      if (input.baseHash && input.baseHash !== existing.contentHash) {
        if (input.baseContent === undefined) {
          throw new AgentToolError(
            "Document changed since you read it. Re-read it, re-apply your edit, and retry with baseContent for merge.",
          );
        }
        const m = threeWayMerge(input.baseContent, existing.content, input.content);
        if (!m.ok) {
          throw new AgentToolError(
            "Merge conflict with a concurrent edit. Re-read the document and retry.",
          );
        }
        resolvedContent = m.merged;
        merged = true;
      }

      const parsed = parseDocument(resolvedContent, input.path);
      const updated = await tx.vaultDocument.update({
        where: { id: existing.id },
        data: {
          title: parsed.title,
          frontmatter: (parsed.frontmatter ?? undefined) as Prisma.InputJsonValue | undefined,
          docType: parsed.docType,
          docStatus: parsed.docStatus,
          tags: parsed.tags,
          content: parsed.content,
          contentHash: parsed.contentHash,
          wordCount: parsed.wordCount,
          directory: parsed.directory,
          section: parsed.section,
          wikilinks: parsed.wikilinks,
          syncedAt: new Date(),
        },
      });
      const lastVersion = await tx.vaultDocumentVersion.findFirst({
        where: { documentId: existing.id },
        orderBy: { versionN: "desc" },
        select: { versionN: true },
      });
      await tx.vaultDocumentVersion.create({
        data: {
          brainId: ctx.primaryBrainId,
          documentId: existing.id,
          path: input.path,
          versionN: (lastVersion?.versionN ?? 0) + 1,
          content: parsed.content,
          contentHash: parsed.contentHash,
          parentHash: existing.contentHash,
          mergeParentHash: merged ? (input.baseHash ?? null) : null,
          source: VERSION_SOURCE,
          changedBy: ctx.identity,
        },
      });
      await tx.vaultChangeLog.create({
        data: {
          brainId: ctx.primaryBrainId,
          documentId: existing.id,
          path: input.path,
          operation: "update",
          source: VERSION_SOURCE,
          changedBy: ctx.identity,
        },
      });
      return {
        tenant,
        docId: updated.id,
        contentHash: updated.contentHash,
        merged,
      };
    },
  );

  await Promise.allSettled([
    updateDocumentEmbedding(result.tenant, result.docId),
    scheduleRebuildLinks(result.tenant, ctx.primaryBrainId),
  ]);
  return JSON.stringify({
    updated: true,
    brain: ctx.primaryBrainName,
    path: input.path,
    contentHash: result.contentHash,
    merged: result.merged,
  });
}
