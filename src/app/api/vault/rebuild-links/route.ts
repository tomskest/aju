import { NextResponse } from "next/server";
import { resolveBrain, isBrainError, canWrite } from "@/lib/vault";
import { rebuildLinks } from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

/**
 * POST /api/vault/rebuild-links?brain=<name>
 *
 * User-facing link-graph rebuild (the `aju rebuild-links` CLI command hits
 * this path). Distinct from /api/cron/rebuild-links, which is the scheduled
 * all-brains variant and may run under platform credentials.
 *
 * Scoped to the resolved brain; write-role required since it mutates
 * document_links. Returns the rebuild summary produced by rebuildLinks().
 */
export const POST = authedTenantRoute(
  async ({ req, tenant, tx, principal }) => {
    const brain = await resolveBrain(tx, req, principal);
    if (isBrainError(brain)) return brain;

    if (!canWrite(brain)) {
      return NextResponse.json(
        { error: "Write access denied for this brain" },
        { status: 403 },
      );
    }

    const start = Date.now();
    const result = await rebuildLinks(tenant, brain.brainId);
    return {
      ok: true,
      brain: brain.brainName,
      rebuilt: result.resolved,
      ...result,
      durationMs: Date.now() - start,
    };
  },
  { requiresScope: "write" },
);
