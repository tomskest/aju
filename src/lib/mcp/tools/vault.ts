/**
 * Vault CRUD MCP tools — read / browse / create / update / delete plus the
 * `aju_brains_list` discovery call. Each handler routes through `withTenant`,
 * resolves the target brain, and (for writes) checks `canWrite` before
 * mutating `vault_documents` and the change log.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Prisma as PrismaTenant } from "@prisma/client-tenant";
import { parseDocument } from "@/lib/vault";
import { scheduleRebuildLinks } from "@/lib/vault";
import { updateDocumentEmbedding } from "@/lib/embeddings";
import { withTenant } from "@/lib/tenant";
import {
  canWrite,
  type McpToolContext,
  errorResult,
  requireOrgId,
  resolveBrainForTool,
  textResult,
} from "./shared";

export function registerVaultTools(
  server: McpServer,
  ctx: McpToolContext,
): void {
  // ── aju_read ────────────────────────────────────────
  server.tool(
    "aju_read",
    "Read a single memory / note / document by its path inside an aju brain. Returns the full markdown content plus frontmatter, tags, and outgoing wikilinks.",
    {
      path: z.string().describe("Vault-relative path (e.g. 'journal/2026-04-16.md')."),
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
              select: {
                path: true,
                title: true,
                section: true,
                directory: true,
                docType: true,
                docStatus: true,
                tags: true,
                frontmatter: true,
                wikilinks: true,
                content: true,
                wordCount: true,
                updatedAt: true,
              },
            });
            if (!doc) return errorResult(`Document not found: ${path}`);
            return textResult({
              brain: b.brainName,
              path: doc.path,
              title: doc.title,
              section: doc.section,
              directory: doc.directory,
              docType: doc.docType,
              docStatus: doc.docStatus,
              tags: doc.tags,
              wikilinks: doc.wikilinks,
              frontmatter: doc.frontmatter,
              wordCount: doc.wordCount,
              updatedAt: doc.updatedAt.toISOString(),
              content: doc.content,
            });
          },
        );
      } catch (err) {
        return errorResult(String(err instanceof Error ? err.message : err));
      }
    },
  );

  // ── aju_browse ──────────────────────────────────────
  server.tool(
    "aju_browse",
    "List documents under a directory prefix in an aju brain. Metadata only — use aju_read for full content. Useful to explore what memories / notes exist in a section.",
    {
      directory: z
        .string()
        .optional()
        .describe("Directory path prefix (e.g. 'journal'). Omit to list the whole brain."),
      brain: z.string().optional().describe("Brain name. Omit for default."),
    },
    async ({ directory, brain }) => {
      try {
        const organizationId = requireOrgId(ctx);
        return await withTenant(
          { organizationId, userId: ctx.userId, agentId: ctx.agentId },
          async ({ tx }) => {
            const b = await resolveBrainForTool(tx, ctx, brain);
            const where: Record<string, unknown> = { brainId: b.brainId };
            if (directory) where.directory = directory;
            const docs = await tx.vaultDocument.findMany({
              where,
              select: {
                path: true,
                title: true,
                section: true,
                directory: true,
                docType: true,
                docStatus: true,
                tags: true,
                wordCount: true,
                updatedAt: true,
              },
              orderBy: { path: "asc" },
              take: 500,
            });
            return textResult({
              brain: b.brainName,
              directory: directory ?? null,
              count: docs.length,
              documents: docs.map((d) => ({
                path: d.path,
                title: d.title,
                section: d.section,
                directory: d.directory,
                docType: d.docType,
                docStatus: d.docStatus,
                tags: d.tags,
                wordCount: d.wordCount,
                updatedAt: d.updatedAt.toISOString(),
              })),
            });
          },
        );
      } catch (err) {
        return errorResult(String(err instanceof Error ? err.message : err));
      }
    },
  );

  // ── aju_create ──────────────────────────────────────
  server.tool(
    "aju_create",
    "Create a new memory / note / document in an aju brain. Content is parsed for frontmatter, tags, and wikilinks; the document is indexed for full-text + semantic search.",
    {
      path: z.string().describe("Vault path (e.g. 'notes/new-thought.md'). Should end in .md."),
      content: z.string().describe("Full markdown content, including optional --- frontmatter --- block."),
      brain: z.string().optional().describe("Brain name. Omit for default."),
    },
    async ({ path, content, brain }) => {
      try {
        const organizationId = requireOrgId(ctx);
        const { tenant, createdId, brainId, brainName } = await withTenant(
          { organizationId, userId: ctx.userId, agentId: ctx.agentId },
          async ({ tenant, tx }) => {
            const b = await resolveBrainForTool(tx, ctx, brain);
            if (!canWrite(b)) {
              throw new Error(`Write access denied for brain: ${b.brainName}`);
            }

            const existing = await tx.vaultDocument.findFirst({
              where: { brainId: b.brainId, path },
              select: { id: true },
            });
            if (existing) {
              throw new Error(`Document already exists: ${path}`);
            }

            const parsed = parseDocument(content, path);
            const doc = await tx.vaultDocument.create({
              data: {
                brainId: b.brainId,
                path,
                title: parsed.title,
                frontmatter: (parsed.frontmatter ?? undefined) as PrismaTenant.InputJsonValue | undefined,
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
              },
            });
            await tx.vaultChangeLog.create({
              data: {
                brainId: b.brainId,
                documentId: doc.id,
                path,
                operation: "insert",
                source: "mcp",
                changedBy: ctx.identity,
              },
            });
            return {
              tenant,
              createdId: doc.id,
              createdPath: doc.path,
              createdTitle: doc.title,
              brainId: b.brainId,
              brainName: b.brainName,
            };
          },
        );

        // fire-and-forget background work, outside the transaction
        scheduleRebuildLinks(tenant, brainId).catch((e) =>
          console.error("[mcp] rebuildLinks after create failed:", e),
        );
        updateDocumentEmbedding(tenant, createdId).catch((e) =>
          console.error("[mcp] embedding after create failed:", e),
        );

        return textResult({
          brain: brainName,
          created: true,
          path,
          id: createdId,
        });
      } catch (err) {
        return errorResult(String(err instanceof Error ? err.message : err));
      }
    },
  );

  // ── aju_update ──────────────────────────────────────
  server.tool(
    "aju_update",
    "Replace the full content of an existing memory / note / document in an aju brain. Re-parses frontmatter and re-indexes embeddings.",
    {
      path: z.string().describe("Existing document path."),
      content: z.string().describe("Full replacement markdown content."),
      brain: z.string().optional().describe("Brain name. Omit for default."),
    },
    async ({ path, content, brain }) => {
      try {
        const organizationId = requireOrgId(ctx);
        const { tenant, updatedId, updatedPath, updatedTitle, brainId, brainName } =
          await withTenant(
            { organizationId, userId: ctx.userId, agentId: ctx.agentId },
            async ({ tenant, tx }) => {
              const b = await resolveBrainForTool(tx, ctx, brain);
              if (!canWrite(b)) {
                throw new Error(`Write access denied for brain: ${b.brainName}`);
              }

              const existing = await tx.vaultDocument.findFirst({
                where: { brainId: b.brainId, path },
                select: { id: true },
              });
              if (!existing) {
                throw new Error(`Document not found: ${path}`);
              }

              const parsed = parseDocument(content, path);
              const updated = await tx.vaultDocument.update({
                where: { id: existing.id },
                data: {
                  title: parsed.title,
                  frontmatter: (parsed.frontmatter ?? undefined) as PrismaTenant.InputJsonValue | undefined,
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
              await tx.vaultChangeLog.create({
                data: {
                  brainId: b.brainId,
                  documentId: existing.id,
                  path,
                  operation: "update",
                  source: "mcp",
                  changedBy: ctx.identity,
                },
              });
              return {
                tenant,
                updatedId: updated.id,
                updatedPath: updated.path,
                updatedTitle: updated.title,
                brainId: b.brainId,
                brainName: b.brainName,
              };
            },
          );

        scheduleRebuildLinks(tenant, brainId).catch((e) =>
          console.error("[mcp] rebuildLinks after update failed:", e),
        );
        updateDocumentEmbedding(tenant, updatedId).catch((e) =>
          console.error("[mcp] embedding after update failed:", e),
        );

        return textResult({
          brain: brainName,
          updated: true,
          path: updatedPath,
          title: updatedTitle,
          id: updatedId,
        });
      } catch (err) {
        return errorResult(String(err instanceof Error ? err.message : err));
      }
    },
  );

  // ── aju_delete ──────────────────────────────────────
  server.tool(
    "aju_delete",
    "Delete a memory / note / document from an aju brain. The deletion is logged in the change history.",
    {
      path: z.string().describe("Path of the document to delete."),
      brain: z.string().optional().describe("Brain name. Omit for default."),
    },
    async ({ path, brain }) => {
      try {
        const organizationId = requireOrgId(ctx);
        const { tenant, brainId, brainName } = await withTenant(
          { organizationId, userId: ctx.userId, agentId: ctx.agentId },
          async ({ tenant, tx }) => {
            const b = await resolveBrainForTool(tx, ctx, brain);
            if (!canWrite(b)) {
              throw new Error(`Write access denied for brain: ${b.brainName}`);
            }

            const existing = await tx.vaultDocument.findFirst({
              where: { brainId: b.brainId, path },
              select: { id: true },
            });
            if (!existing) {
              throw new Error(`Document not found: ${path}`);
            }

            await tx.vaultChangeLog.create({
              data: {
                brainId: b.brainId,
                documentId: existing.id,
                path,
                operation: "delete",
                source: "mcp",
                changedBy: ctx.identity,
              },
            });
            await tx.vaultDocument.delete({ where: { id: existing.id } });

            return {
              tenant,
              brainId: b.brainId,
              brainName: b.brainName,
            };
          },
        );

        scheduleRebuildLinks(tenant, brainId).catch((e) =>
          console.error("[mcp] rebuildLinks after delete failed:", e),
        );

        return textResult({ brain: brainName, deleted: path });
      } catch (err) {
        return errorResult(String(err instanceof Error ? err.message : err));
      }
    },
  );

  // ── aju_brains_list ─────────────────────────────────
  server.tool(
    "aju_brains_list",
    "List all aju brains the authenticated user has access to. Returns name, type, role, and document count. Use the 'name' field as the 'brain' argument for other tools.",
    {},
    async () => {
      try {
        const organizationId = requireOrgId(ctx);
        return await withTenant(
          { organizationId, userId: ctx.userId, agentId: ctx.agentId },
          async ({ tx }) => {
            if (ctx.userId) {
              const access = await tx.brainAccess.findMany({
                where: { userId: ctx.userId },
                include: {
                  brain: { include: { _count: { select: { documents: true } } } },
                },
                orderBy: { brain: { createdAt: "asc" } },
              });
              return textResult({
                count: access.length,
                brains: access.map((a) => ({
                  name: a.brain.name,
                  type: a.brain.type,
                  role: a.role,
                  documentCount: a.brain._count.documents,
                })),
              });
            }
            // Legacy env-var path — list every brain in this tenant DB.
            const brains = await tx.brain.findMany({
              include: { _count: { select: { documents: true } } },
              orderBy: { createdAt: "asc" },
            });
            return textResult({
              count: brains.length,
              brains: brains.map((b) => ({
                name: b.name,
                type: b.type,
                role: "editor",
                documentCount: b._count.documents,
              })),
            });
          },
        );
      } catch (err) {
        return errorResult(String(err instanceof Error ? err.message : err));
      }
    },
  );
}
