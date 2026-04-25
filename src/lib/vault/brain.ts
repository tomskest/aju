import { NextRequest, NextResponse } from "next/server";
import type {
  PrismaClient as PrismaClientTenant,
  Prisma as PrismaTenant,
} from "@prisma/client-tenant";
import type { AuthSuccess } from "@/lib/auth";

type TenantTx = PrismaTenant.TransactionClient;
type TenantReader = PrismaClientTenant | TenantTx;

export type BrainContext = {
  brainId: string;
  brainName: string;
  brainType: string;
  accessRole: string;
};

/**
 * Resolve which brain a request targets against a tenant data source.
 *
 * Post-split the organization boundary is the database, so all queries go
 * through the `tenant` client (or transaction). Brain-access is the sole
 * authorization signal for authenticated users. Env-var callers have no
 * BrainAccess graph — they see every brain in the tenant DB.
 *
 * Resolution order:
 *   1. Explicit `?brain=<name>` → for a real user, lookup by (name, userId).
 *      For env-var callers, name-only lookup (single-tenant CLI path).
 *   2. Authenticated user → first accessible brain, preferring `type=personal`.
 *   3. Env-var caller → first `type=org` brain, else any brain.
 */
/**
 * Build a BrainAccess filter for the authenticated principal. Agents filter
 * by agent_id (exclusively — agents see only grants); humans by user_id.
 * Env-var / legacy callers (no userId, no agentId) return null, which
 * callers treat as "anonymous admin — no BrainAccess gate".
 */
function principalAccessFilter(
  auth?: AuthSuccess,
): { userId: string } | { agentId: string } | null {
  if (auth?.agentId) return { agentId: auth.agentId };
  if (auth?.userId) return { userId: auth.userId };
  return null;
}

export async function resolveBrain(
  tenant: TenantReader,
  req: NextRequest,
  auth?: AuthSuccess,
): Promise<BrainContext | NextResponse> {
  const requestedBrain = req.nextUrl.searchParams.get("brain") || null;
  const principal = principalAccessFilter(auth);

  if (requestedBrain && requestedBrain !== "all") {
    if (principal) {
      const access = await tenant.brainAccess.findFirst({
        where: {
          ...principal,
          brain: { name: requestedBrain },
        },
        include: { brain: true },
      });
      if (!access) {
        return NextResponse.json(
          { error: `Brain not found or access denied: ${requestedBrain}` },
          { status: 403 },
        );
      }
      return {
        brainId: access.brain.id,
        brainName: access.brain.name,
        brainType: access.brain.type,
        accessRole: access.role,
      };
    }

    const brain = await tenant.brain.findFirst({
      where: { name: requestedBrain },
    });
    if (!brain) {
      return NextResponse.json(
        { error: `Brain not found: ${requestedBrain}` },
        { status: 404 },
      );
    }
    return {
      brainId: brain.id,
      brainName: brain.name,
      brainType: brain.type,
      accessRole: "editor",
    };
  }

  if (principal) {
    const personal = await tenant.brainAccess.findFirst({
      where: { ...principal, brain: { type: "personal" } },
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
      const subject = auth?.agentId ? "this agent" : "this user";
      return NextResponse.json(
        { error: `No brain configured for ${subject}` },
        { status: 404 },
      );
    }
    return {
      brainId: chosen.brain.id,
      brainName: chosen.brain.name,
      brainType: chosen.brain.type,
      accessRole: chosen.role,
    };
  }

  const defaultBrain =
    (await tenant.brain.findFirst({ where: { type: "org" } })) ??
    (await tenant.brain.findFirst({}));

  if (!defaultBrain) {
    return NextResponse.json(
      { error: "No brain configured" },
      { status: 500 },
    );
  }

  return {
    brainId: defaultBrain.id,
    brainName: defaultBrain.name,
    brainType: defaultBrain.type,
    accessRole: "editor",
  };
}

/**
 * All brain IDs the caller can access in the given tenant DB.
 * For authenticated users, via BrainAccess. For env-var callers, every brain
 * in the tenant (single-tenant admin path).
 */
export async function resolveAccessibleBrainIds(
  tenant: TenantReader,
  auth?: AuthSuccess,
): Promise<string[]> {
  const principal = principalAccessFilter(auth);
  if (principal) {
    const accesses = await tenant.brainAccess.findMany({
      where: principal,
      select: { brainId: true },
    });
    return accesses.map((a) => a.brainId);
  }

  const allBrains = await tenant.brain.findMany({ select: { id: true } });
  return allBrains.map((b) => b.id);
}

export function isBrainError(
  result: BrainContext | BrainContext[] | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}

export function isAllBrains(req: NextRequest): boolean {
  return req.nextUrl.searchParams.get("brain") === "all";
}

export function canWrite(ctx: BrainContext): boolean {
  return ctx.accessRole === "owner" || ctx.accessRole === "editor";
}

/**
 * Resolve a list of brains for a search-style request that may span one,
 * many, or all accessible brains. Shape of the brain param:
 *   - `?brain=all`               → every brain the caller can access
 *   - `?brain=a&brain=b`         → exactly those brains, access-checked
 *   - `?brain=a,b`               → same, comma-separated in one value
 *   - `?brain=a`                 → single brain (access-checked)
 *   - (omitted)                  → caller's default brain (from resolveBrain)
 */
export async function resolveBrainIds(
  tenant: TenantReader,
  req: NextRequest,
  auth?: AuthSuccess,
): Promise<BrainContext[] | NextResponse> {
  const raw = req.nextUrl.searchParams.getAll("brain");

  if (raw.length === 0) {
    const single = await resolveBrain(tenant, req, auth);
    if (isBrainError(single)) return single;
    return [single];
  }

  const names: string[] = [];
  for (const v of raw) {
    for (const part of v.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) names.push(trimmed);
    }
  }

  if (names.length === 1 && names[0] === "all") {
    return loadBrainContexts(
      tenant,
      await resolveAccessibleBrainIds(tenant, auth),
      auth,
    );
  }

  const seenNames = new Set<string>();
  const wanted: string[] = [];
  for (const n of names) {
    if (n === "all") continue;
    if (seenNames.has(n)) continue;
    seenNames.add(n);
    wanted.push(n);
  }

  if (wanted.length === 0) {
    return NextResponse.json({ error: "No brain specified" }, { status: 400 });
  }

  const principal = principalAccessFilter(auth);
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
      return NextResponse.json(
        {
          error: `Brain not found or access denied: ${missing.join(", ")}`,
        },
        { status: 403 },
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
    return NextResponse.json(
      { error: `Brain not found: ${missing.join(", ")}` },
      { status: 404 },
    );
  }
  return wanted.map((n) => {
    const b = byName.get(n)!;
    return {
      brainId: b.id,
      brainName: b.name,
      brainType: b.type,
      accessRole: "editor" as const,
    };
  });
}

async function loadBrainContexts(
  tenant: TenantReader,
  ids: string[],
  auth?: AuthSuccess,
): Promise<BrainContext[]> {
  if (ids.length === 0) return [];
  const brains = await tenant.brain.findMany({
    where: { id: { in: ids } },
  });
  let roleById = new Map<string, string>();
  const principal = principalAccessFilter(auth);
  if (principal) {
    const accesses = await tenant.brainAccess.findMany({
      where: { ...principal, brainId: { in: ids } },
      select: { brainId: true, role: true },
    });
    roleById = new Map(accesses.map((a) => [a.brainId, a.role]));
  }
  return brains.map((b) => ({
    brainId: b.id,
    brainName: b.name,
    brainType: b.type,
    accessRole: roleById.get(b.id) ?? "editor",
  }));
}
