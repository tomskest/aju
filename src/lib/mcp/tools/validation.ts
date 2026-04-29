/**
 * Validation MCP tools — let agents promote memories to validated, mark
 * them stale, disqualify wrong content, or read the current validation
 * state. Mutations always go through the same logic the REST validate
 * route uses (writes a vault_validation_log row in the same tx, snapshots
 * contentHash server-side).
 *
 * Tool descriptions are tuned for LLM use: rich keyword cues so hosts
 * route to the right tool, plus explicit guidance on when each transition
 * is appropriate. The skill body at client/cli/cmd/skill_body.md teaches
 * the host how to interpret validation states; these tool descriptions
 * teach when to write them.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withTenant } from "@/lib/tenant";
import type { ResolvedBrain } from "./shared";
import {
  type McpToolContext,
  errorResult,
  requireOrgId,
  resolveBrainForTool,
  textResult,
} from "./shared";

// Mirrors src/lib/vault/brain.ts canValidate(). Personal brains are
// owner-only for validation; org brains accept editor or owner.
function canValidate(brain: ResolvedBrain): boolean {
  if (brain.brainType === "personal") return brain.accessRole === "owner";
  return brain.accessRole === "owner" || brain.accessRole === "editor";
}

type Status = "validated" | "stale" | "disqualified" | "unvalidated";

export function registerValidationTools(
  server: McpServer,
  ctx: McpToolContext,
): void {
  // Single underlying mutation. The four "human-friendly" tools below all
  // funnel through this so transition logic stays in one place.
  const mutate = async (
    status: Status,
    args: { path: string; brain?: string; reason?: string },
  ) => {
    try {
      const organizationId = requireOrgId(ctx);
      return await withTenant(
        { organizationId, userId: ctx.userId, agentId: ctx.agentId },
        async ({ tx }) => {
          const b = await resolveBrainForTool(tx, ctx, args.brain);
          if (!canValidate(b)) {
            return errorResult(
              b.brainType === "personal"
                ? "Validation forbidden: personal brains are owner-only for validation."
                : "Validation forbidden: editor or owner role required.",
            );
          }

          const existing = await tx.vaultDocument.findFirst({
            where: { brainId: b.brainId, path: args.path },
          });
          if (!existing) {
            return errorResult(`Document not found: ${args.path}`);
          }

          if (existing.validationStatus === status) {
            return textResult({
              brain: b.brainName,
              path: args.path,
              status,
              changed: false,
              note: "Already in this state — no change written.",
            });
          }

          const now = new Date();
          const data: Record<string, unknown> = {
            validationStatus: status,
          };
          switch (status) {
            case "validated":
              data.validatedAt = now;
              data.validatedBy = ctx.identity;
              data.validatedHash = existing.contentHash;
              data.disqualifiedAt = null;
              data.disqualifiedBy = null;
              break;
            case "disqualified":
              data.disqualifiedAt = now;
              data.disqualifiedBy = ctx.identity;
              break;
            case "stale":
              break;
            case "unvalidated":
              data.validatedAt = null;
              data.validatedBy = null;
              data.validatedHash = null;
              data.disqualifiedAt = null;
              data.disqualifiedBy = null;
              break;
          }

          await tx.vaultDocument.update({
            where: { id: existing.id },
            data,
          });

          await tx.vaultValidationLog.create({
            data: {
              brainId: b.brainId,
              documentId: existing.id,
              path: args.path,
              fromStatus: existing.validationStatus,
              toStatus: status,
              fromProvenance: existing.provenance,
              toProvenance: existing.provenance,
              contentHashAt: existing.contentHash,
              source: "mcp",
              changedBy: ctx.identity,
              actorType: ctx.agentId ? "agent" : "user",
              reason: args.reason ?? null,
            },
          });

          return textResult({
            brain: b.brainName,
            path: args.path,
            status,
            changed: true,
            from: existing.validationStatus,
          });
        },
      );
    } catch (err) {
      return errorResult(String(err instanceof Error ? err.message : err));
    }
  };

  // ── aju_validate ────────────────────────────────────
  server.tool(
    "aju_validate",
    "Mark a memory / note as VALIDATED — the user has confirmed this content is accurate. Use after the user explicitly confirms a fact you saved, after a successful action verifies a stored claim, or when reviewing notes for canonicality. Validation snapshots the current content hash; if the document is later edited, the validation auto-flips to 'stale'. Personal brains require owner; org brains accept editor.",
    {
      path: z.string().describe("Vault-relative path of the doc to validate."),
      brain: z.string().optional().describe("Brain name. Omit for default."),
      reason: z
        .string()
        .max(500)
        .optional()
        .describe("Optional note recorded in validation history."),
    },
    async ({ path, brain, reason }) => mutate("validated", { path, brain, reason }),
  );

  // ── aju_mark_stale ──────────────────────────────────
  server.tool(
    "aju_mark_stale",
    "Mark a memory as STALE — content was probably true once but the underlying source has shifted. Use when the user says something like 'that's outdated' or when external context contradicts a stored claim but the text hasn't been edited. Stale items are demoted in default search; users can opt back in with --include-stale.",
    {
      path: z.string().describe("Vault-relative path."),
      brain: z.string().optional().describe("Brain name. Omit for default."),
      reason: z.string().max(500).optional(),
    },
    async ({ path, brain, reason }) => mutate("stale", { path, brain, reason }),
  );

  // ── aju_disqualify ──────────────────────────────────
  server.tool(
    "aju_disqualify",
    "Mark a memory as DISQUALIFIED — actively wrong, misleading, or unsafe to cite. Use when the user explicitly says 'that's wrong' about something you retrieved. Disqualified docs are excluded from default search entirely. Reversible via aju_clear_validation.",
    {
      path: z.string().describe("Vault-relative path."),
      brain: z.string().optional().describe("Brain name. Omit for default."),
      reason: z
        .string()
        .max(500)
        .optional()
        .describe("Why this is wrong — recorded in history; helpful for future review."),
    },
    async ({ path, brain, reason }) => mutate("disqualified", { path, brain, reason }),
  );

  // ── aju_clear_validation ────────────────────────────
  server.tool(
    "aju_clear_validation",
    "Reset a memory back to UNVALIDATED. Use when a previous validation/disqualification was a mistake and you want to drop it without leaving a tombstone. Clears validatedAt/By, validatedHash, disqualifiedAt/By; the prior state stays in validation history.",
    {
      path: z.string().describe("Vault-relative path."),
      brain: z.string().optional().describe("Brain name. Omit for default."),
      reason: z.string().max(500).optional(),
    },
    async ({ path, brain, reason }) =>
      mutate("unvalidated", { path, brain, reason }),
  );

  // ── aju_validation_status ───────────────────────────
  server.tool(
    "aju_validation_status",
    "Read the current validation state for a document plus its recent state-change history. Use to answer 'is this validated?' or 'who flagged this as wrong?' questions before citing a memory.",
    {
      path: z.string().describe("Vault-relative path."),
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
                id: true,
                path: true,
                contentHash: true,
                provenance: true,
                validationStatus: true,
                validatedAt: true,
                validatedBy: true,
                validatedHash: true,
                disqualifiedAt: true,
                disqualifiedBy: true,
              },
            });
            if (!doc) return errorResult(`Document not found: ${path}`);

            const log = await tx.vaultValidationLog.findMany({
              where: { documentId: doc.id },
              orderBy: { createdAt: "desc" },
              take: 20,
            });

            return textResult({
              brain: b.brainName,
              path: doc.path,
              contentHash: doc.contentHash,
              validation: {
                status: doc.validationStatus,
                provenance: doc.provenance,
                validatedAt: doc.validatedAt?.toISOString() ?? null,
                validatedBy: doc.validatedBy,
                validatedHash: doc.validatedHash,
                disqualifiedAt: doc.disqualifiedAt?.toISOString() ?? null,
                disqualifiedBy: doc.disqualifiedBy,
              },
              recentLog: log.map((r) => ({
                fromStatus: r.fromStatus,
                toStatus: r.toStatus,
                source: r.source,
                changedBy: r.changedBy,
                actorType: r.actorType,
                reason: r.reason,
                createdAt: r.createdAt.toISOString(),
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
