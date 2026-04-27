import { NextRequest, NextResponse } from "next/server";
import {
  resolveBrain,
  isBrainError,
  canWrite,
  autoLinkBrain,
  rebuildLinks,
} from "@/lib/vault";
import { currentAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveTenantAccess, withBrainContext } from "@/lib/tenant";
import { requireScope } from "@/lib/route-helpers";
import type { AuthSuccess } from "@/lib/auth";
import type { OrgRole } from "@/lib/tenant";

/**
 * POST /api/vault/auto-link?brain=<name>
 *
 * Heuristic auto-linker — scans every doc in the brain and inserts
 * `[[wikilinks]]` for mentions of other docs (basename / title /
 * frontmatter aliases). Idempotent.
 *
 * Why this route does NOT use `authedTenantRoute`:
 *
 * The tenant DB runs through PgBouncer with Prisma's enforced
 * `connection_limit=1`. `authedTenantRoute` opens an interactive tx that
 * holds that single connection for the whole handler. `autoLinkBrain` and
 * `rebuildLinks` then issue their own queries via the bare `tenant`
 * client; with the parent tx still holding the connection, those calls
 * starve in the pool and fail with P2024 ("Timed out fetching a new
 * connection from the connection pool").
 *
 * So we manually do the access check inside a brief `withBrainContext`,
 * release that tx, and only then run the bulk work — at which point the
 * single connection is free for autoLinkBrain's serial queries and
 * rebuildLinks' own internal tx.
 *
 * Write-role required since the linker mutates every doc body.
 */
export async function POST(req: NextRequest) {
  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!auth.organizationId) {
    return NextResponse.json({ error: "no_active_org" }, { status: 400 });
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: auth.user.id, organizationId: auth.organizationId },
    select: { role: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const scopeDenied = requireScope(auth, "write");
  if (scopeDenied) return scopeDenied;

  let stage: "access" | "autoLinkBrain" | "rebuildLinks" = "access";
  try {
    const { tenant, brainIds } = await resolveTenantAccess(
      auth.organizationId,
      { userId: auth.user.id, agentId: auth.agentId },
    );

    const principal: AuthSuccess = {
      identity: auth.agentId ? `agent:${auth.agentId}` : auth.user.email,
      userId: auth.user.id,
      email: auth.user.email,
      role: membership.role as OrgRole,
      apiKeyId: auth.apiKeyId,
      organizationId: auth.organizationId,
      agentId: auth.agentId,
      scopes: auth.scopes,
    };

    // Brief tx to verify brain access — released before bulk work runs.
    const brain = await withBrainContext(tenant, brainIds, async (tx) =>
      resolveBrain(tx, req, principal),
    );
    if (isBrainError(brain)) return brain;

    if (!canWrite(brain)) {
      return NextResponse.json(
        { error: "Write access denied for this brain" },
        { status: 403 },
      );
    }

    // Bulk work — no parent tx is holding the single connection now, so
    // autoLinkBrain's serial queries and rebuildLinks' inner $transaction
    // can each acquire it briefly.
    const start = Date.now();
    stage = "autoLinkBrain";
    const auto = await autoLinkBrain(tenant, brain.brainId);
    stage = "rebuildLinks";
    const links = await rebuildLinks(tenant, brain.brainId);

    return NextResponse.json({
      ok: true,
      brain: brain.brainName,
      autoLinks: auto,
      links,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined;
    console.error(
      `[auto-link route] stage=${stage} code=${code ?? "n/a"}`,
      err,
    );
    return NextResponse.json(
      { error: "auto_link_failed", stage, code, message },
      { status: 500 },
    );
  }
}
