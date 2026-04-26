import { NextRequest, NextResponse } from "next/server";
import { resolveBrain, isBrainError, canWrite } from "@/lib/vault";
import { reindexBrain } from "@/lib/embeddings";
import { currentAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveTenantAccess, withBrainContext } from "@/lib/tenant";
import type { AuthSuccess } from "@/lib/auth";
import type { OrgRole } from "@/lib/tenant";

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
 *
 * Why this route does NOT use `authedTenantRoute` (same reasoning as
 * /api/vault/auto-link):
 *
 * The tenant DB runs through PgBouncer with Prisma's enforced
 * `connection_limit=1`. `authedTenantRoute` opens an interactive tx that
 * holds that single connection for the whole handler. `reindexBrain` then
 * issues `tenant.$executeRaw` / `$queryRaw` calls plus `autoLinkBrain` and
 * `rebuildLinks` via the bare `tenant` client; with the parent tx still
 * holding the connection, those calls starve in the pool and fail with
 * P2024 ("Timed out fetching a new connection from the connection pool").
 *
 * Reindex also makes Voyage API calls between DB writes — holding a tx
 * open across network I/O is doubly bad. So we do a brief access check
 * inside a `withBrainContext`, release it, then run the bulk work with the
 * single connection free for the embedding/auto-link/rebuild pipeline.
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

  let body: {
    refreshAll?: boolean;
    fts?: boolean;
    embeddings?: boolean;
    links?: boolean;
    autoLinks?: boolean;
  } = {};
  try {
    const text = await req.text();
    if (text.trim() !== "") body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let stage: "access" | "reindex" = "access";
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
    // reindexBrain's serial $executeRaw / $queryRaw calls plus its inner
    // autoLinkBrain + rebuildLinks invocations can each acquire it briefly.
    stage = "reindex";
    const result = await reindexBrain(tenant, brain.brainId, body);

    return NextResponse.json({
      ok: true,
      brain: brain.brainName,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined;
    console.error(
      `[reindex route] stage=${stage} code=${code ?? "n/a"}`,
      err,
    );
    return NextResponse.json(
      { error: "reindex_failed", stage, code, message },
      { status: 500 },
    );
  }
}
