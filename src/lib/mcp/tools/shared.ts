/**
 * Shared primitives for the per-domain MCP tool registrations.
 *
 * Keeps the `registerXxxTools(server, ctx)` functions slim and consistent: the
 * same context shape, the same result builders, and the same brain resolvers
 * everywhere. Anything used by only one domain stays in that domain's file;
 * anything used by two or more lives here.
 */
import type {
  PrismaClient as PrismaClientTenant,
  Prisma as PrismaTenant,
} from "@prisma/client-tenant";

// ─── Types ──────────────────────────────────────────────

type TenantTx = PrismaTenant.TransactionClient;
export type TenantReader = PrismaClientTenant | TenantTx;

/**
 * Context passed to every domain's `register*Tools(server, ctx)` call.
 *
 * `organizationId` is required — every handler routes to a tenant DB and
 * there's no cross-org fallback post-split.
 */
export type McpToolContext = {
  /** The authenticated user id (from `aju_live_*` key). */
  userId?: string;
  /**
   * When set, this key authenticates AS an agent. Tenant-DB queries should
   * resolve BrainAccess by agentId rather than userId; `userId` is still the
   * human who owns/minted the key but is not the principal.
   */
  agentId?: string;
  /**
   * Organization whose tenant DB this context routes to. Required — there's
   * no single cross-org fallback database any more.
   */
  organizationId: string;
  /** Identity string for changelog attribution (email, agent id, or `admin`). */
  identity: string;
  /** Optional fallback brain name when the tool call doesn't specify one. */
  defaultBrain?: string;
};

export type ResolvedBrain = {
  brainId: string;
  brainName: string;
  brainType: string;
  accessRole: string;
};

// ─── Context helpers ────────────────────────────────────

export function requireOrgId(ctx: McpToolContext): string {
  if (!ctx.organizationId) {
    throw new Error("MCP: requires organizationId");
  }
  return ctx.organizationId;
}

/**
 * BrainAccess filter for the authenticated principal. Agent keys look up
 * their grants by agent_id; human keys by user_id. Returns null only for
 * legacy env-var callers (no key, no ctx identity) — none of the MCP tools
 * should see that path since requireOrgId already rejects anonymous use.
 */
export function ctxPrincipalFilter(
  ctx: McpToolContext,
): { agentId: string } | { userId: string } | null {
  if (ctx.agentId) return { agentId: ctx.agentId };
  if (ctx.userId) return { userId: ctx.userId };
  return null;
}

// ─── Brain resolution ───────────────────────────────────

export async function resolveBrainForTool(
  tenant: TenantReader,
  ctx: McpToolContext,
  requested?: string,
): Promise<ResolvedBrain> {
  const wanted = requested ?? ctx.defaultBrain;

  const principal = ctxPrincipalFilter(ctx);

  // Specific brain requested.
  if (wanted && wanted !== "all") {
    if (principal) {
      const access = await tenant.brainAccess.findFirst({
        where: {
          ...principal,
          brain: { name: wanted },
        },
        include: { brain: true },
      });
      if (!access) {
        throw new Error(`Brain not found or access denied: ${wanted}`);
      }
      return {
        brainId: access.brain.id,
        brainName: access.brain.name,
        brainType: access.brain.type,
        accessRole: access.role,
      };
    }

    // Env-var / legacy caller — name lookup only within this tenant DB.
    const brain = await tenant.brain.findFirst({
      where: { name: wanted },
    });
    if (!brain) throw new Error(`Brain not found: ${wanted}`);
    return {
      brainId: brain.id,
      brainName: brain.name,
      brainType: brain.type,
      accessRole: "editor",
    };
  }

  // No explicit brain — prefer the principal's first personal brain, then any.
  if (principal) {
    const personal = await tenant.brainAccess.findFirst({
      where: {
        ...principal,
        brain: { type: "personal" },
      },
      include: { brain: true },
      orderBy: { createdAt: "asc" },
    });
    const chosen =
      personal ??
      (await tenant.brainAccess.findFirst({
        where: principal,
        include: { brain: true },
        orderBy: { createdAt: "asc" },
      }));
    if (!chosen) {
      throw new Error(
        ctx.agentId
          ? "No brains granted to this agent"
          : "No brain configured for this user",
      );
    }
    return {
      brainId: chosen.brain.id,
      brainName: chosen.brain.name,
      brainType: chosen.brain.type,
      accessRole: chosen.role,
    };
  }

  const fallback =
    (await tenant.brain.findFirst({ where: { type: "org" } })) ??
    (await tenant.brain.findFirst({}));
  if (!fallback) throw new Error("No brain configured");
  return {
    brainId: fallback.id,
    brainName: fallback.name,
    brainType: fallback.type,
    accessRole: "editor",
  };
}

/**
 * Multi-brain resolver for search-style tools. Accepts:
 *   - undefined              → caller's default brain (single)
 *   - "all"                  → every accessible brain
 *   - single name            → that brain (access-checked)
 *   - array of names         → all of those brains (access-checked)
 *
 * Returns an ordered, de-duplicated list of ResolvedBrain. Throws with a
 * clear message on the first brain that fails access so the model surfaces
 * the actionable hint.
 */
export async function resolveBrainsForTool(
  tenant: TenantReader,
  ctx: McpToolContext,
  requested: string | string[] | undefined,
): Promise<ResolvedBrain[]> {
  if (requested === undefined || requested === null) {
    return [await resolveBrainForTool(tenant, ctx, undefined)];
  }

  if (typeof requested === "string") {
    if (requested === "all") {
      return loadAccessibleBrains(tenant, ctx);
    }
    // Allow comma-separated shorthand ("a,b") in the string form so CLI/MCP
    // clients that can only send scalars still get multi-brain.
    if (requested.includes(",")) {
      const parts = requested
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return resolveBrainList(tenant, ctx, parts);
    }
    return [await resolveBrainForTool(tenant, ctx, requested)];
  }

  const trimmed = requested
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);
  if (trimmed.length === 0) {
    return [await resolveBrainForTool(tenant, ctx, undefined)];
  }
  if (trimmed.length === 1 && trimmed[0] === "all") {
    return loadAccessibleBrains(tenant, ctx);
  }
  return resolveBrainList(
    tenant,
    ctx,
    trimmed.filter((s) => s !== "all"),
  );
}

async function resolveBrainList(
  tenant: TenantReader,
  ctx: McpToolContext,
  names: string[],
): Promise<ResolvedBrain[]> {
  const seen = new Set<string>();
  const wanted = names.filter((n) => {
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  if (wanted.length === 0) {
    return [await resolveBrainForTool(tenant, ctx, undefined)];
  }

  const principal = ctxPrincipalFilter(ctx);
  if (principal) {
    const accesses = await tenant.brainAccess.findMany({
      where: {
        ...principal,
        brain: { name: { in: wanted } },
      },
      include: { brain: true },
    });
    const byName = new Map(accesses.map((a) => [a.brain.name, a]));
    const missing = wanted.filter((n) => !byName.has(n));
    if (missing.length > 0) {
      throw new Error(
        `Brain not found or access denied: ${missing.join(", ")}`,
      );
    }
    return wanted.map((n) => {
      const a = byName.get(n)!;
      return {
        brainId: a.brain.id,
        brainName: a.brain.name,
        brainType: a.brain.type,
        accessRole: a.role,
      };
    });
  }

  const brains = await tenant.brain.findMany({
    where: { name: { in: wanted } },
  });
  const byName = new Map(brains.map((b) => [b.name, b]));
  const missing = wanted.filter((n) => !byName.has(n));
  if (missing.length > 0) {
    throw new Error(`Brain not found: ${missing.join(", ")}`);
  }
  return wanted.map((n) => {
    const b = byName.get(n)!;
    return {
      brainId: b.id,
      brainName: b.name,
      brainType: b.type,
      accessRole: "editor",
    };
  });
}

async function loadAccessibleBrains(
  tenant: TenantReader,
  ctx: McpToolContext,
): Promise<ResolvedBrain[]> {
  const principal = ctxPrincipalFilter(ctx);
  if (principal) {
    const accesses = await tenant.brainAccess.findMany({
      where: principal,
      include: { brain: true },
      orderBy: { createdAt: "asc" },
    });
    return accesses.map((a) => ({
      brainId: a.brain.id,
      brainName: a.brain.name,
      brainType: a.brain.type,
      accessRole: a.role,
    }));
  }
  const brains = await tenant.brain.findMany({});
  return brains.map((b) => ({
    brainId: b.id,
    brainName: b.name,
    brainType: b.type,
    accessRole: "editor",
  }));
}

export function canWrite(brain: ResolvedBrain): boolean {
  return brain.accessRole === "owner" || brain.accessRole === "editor";
}

// ─── Result helpers ─────────────────────────────────────

export function textResult(payload: unknown) {
  const text =
    typeof payload === "string"
      ? payload
      : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}
