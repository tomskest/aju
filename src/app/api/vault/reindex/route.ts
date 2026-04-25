import { NextResponse } from "next/server";
import { resolveBrain, isBrainError, canWrite } from "@/lib/vault";
import { reindexBrain } from "@/lib/embeddings";
import { authedTenantRoute } from "@/lib/route-helpers";

/**
 * POST /api/vault/reindex?brain=<name>
 *
 * Repopulate derived indexes (FTS search_vector, Voyage embeddings, wikilink
 * graph) for the scoped brain. Runs on-demand; safe to re-run. Write-role
 * required because it consumes embedding quota and mutates derived columns.
 *
 * Body (optional JSON):
 *   {
 *     "refreshAll": boolean,   // redo every row, not just missing indexes
 *     "fts": boolean,          // default true
 *     "embeddings": boolean,   // default true
 *     "links": boolean         // default true
 *   }
 */
export const POST = authedTenantRoute(
  async ({ req, tenant, tx, principal }) => {
    let body: {
      refreshAll?: boolean;
      fts?: boolean;
      embeddings?: boolean;
      links?: boolean;
    } = {};
    try {
      const text = await req.text();
      if (text.trim() !== "") body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const brain = await resolveBrain(tx, req, principal);
    if (isBrainError(brain)) return brain;

    if (!canWrite(brain)) {
      return NextResponse.json(
        { error: "Write access denied for this brain" },
        { status: 403 },
      );
    }

    const result = await reindexBrain(tenant, brain.brainId, body);
    return {
      ok: true,
      brain: brain.brainName,
      ...result,
    };
  },
  // Reindex generates Voyage embeddings in 100-doc batches + rebuilds the
  // wikilink graph inside the same handler; Prisma's default 5s interactive-
  // transaction timeout is too short for brains with more than ~20 docs and
  // causes P2028 commit-after-expiry errors.
  { timeoutMs: 120_000 },
);
