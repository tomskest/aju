import { NextResponse } from "next/server";
import {
  resolveBrain,
  isBrainError,
  canWrite,
  autoLinkBrain,
  rebuildLinks,
} from "@/lib/vault";
import { authedTenantRoute } from "@/lib/route-helpers";

/**
 * POST /api/vault/auto-link?brain=<name>
 *
 * User-facing trigger for the heuristic auto-linker. Scans every doc in
 * the brain and inserts `[[wikilinks]]` for mentions of other docs (by
 * basename / title / frontmatter aliases). Idempotent — re-running on a
 * fully-linked brain is a no-op.
 *
 * Auto-link runs as part of vault create/update fire-and-forget for new
 * writes; this endpoint is for backfill scenarios:
 *   - Existing brain pre-dates auto-link
 *   - User just added a hub doc and wants existing content to link to it
 *   - Bulk import (`?defer_index=1`) skipped per-doc auto-link
 *
 * Always chains a `rebuildLinks` after — newly-inserted wikilinks are
 * useless unless the document_links edge table picks them up.
 *
 * Write-role required since it mutates the body of every doc in the
 * brain.
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
    const auto = await autoLinkBrain(tenant, brain.brainId);
    const links = await rebuildLinks(tenant, brain.brainId);

    return {
      ok: true,
      brain: brain.brainName,
      autoLinks: auto,
      links,
      durationMs: Date.now() - start,
    };
  },
  // autoLinkBrain loops over every doc — load candidates + update each one
  // serially. On a brain with more than ~20 docs, this exceeds Prisma's
  // default 5s interactive-tx timeout and rolls back with P2028. Match the
  // reindex route's posture and give the parent tx 120s.
  { timeoutMs: 120_000 },
);
