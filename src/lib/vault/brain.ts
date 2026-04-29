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
      if (access) {
        return {
          brainId: access.brain.id,
          brainName: access.brain.name,
          brainType: access.brain.type,
          accessRole: access.role,
        };
      }

      // Org-fallback: a `type: "org"` brain visible to the caller via
      // organization membership (RLS-scoped through `app.current_brain_ids`,
      // populated by resolveTenantAccess). Personal brains never reach this
      // branch because the type filter excludes them. Members get editor
      // access — org brains are shared workspaces, not read-only views.
      const orgBrain = !auth?.agentId
        ? await tenant.brain.findFirst({
            where: { name: requestedBrain, type: "org" },
          })
        : null;
      if (orgBrain) {
        return {
          brainId: orgBrain.id,
          brainName: orgBrain.name,
          brainType: orgBrain.type,
          accessRole: "editor",
        };
      }

      return NextResponse.json(
        { error: `Brain not found or access denied: ${requestedBrain}` },
        { status: 403 },
      );
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
    if (chosen) {
      return {
        brainId: chosen.brain.id,
        brainName: chosen.brain.name,
        brainType: chosen.brain.type,
        accessRole: chosen.role,
      };
    }

    // No explicit access. For human principals, default-pick any `type: "org"`
    // brain reachable via org-fallback. RLS ensures only accessible brains
    // surface here.
    if (!auth?.agentId) {
      const orgBrain = await tenant.brain.findFirst({
        where: { type: "org" },
        orderBy: { createdAt: "asc" },
      });
      if (orgBrain) {
        return {
          brainId: orgBrain.id,
          brainName: orgBrain.name,
          brainType: orgBrain.type,
          accessRole: "editor",
        };
      }
    }

    const subject = auth?.agentId ? "this agent" : "this user";
    return NextResponse.json(
      { error: `No brain configured for ${subject}` },
      { status: 404 },
    );
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
 *
 * Inside a `withTenant` scope, RLS pins `app.current_brain_ids` to the
 * caller's accessible set (BrainAccess + org-fallback for human members of
 * `type: "org"` brains). Listing brains directly therefore yields exactly
 * the rows the caller may read. Env-var / legacy callers fall back to the
 * full tenant list (single-tenant admin path).
 */
export async function resolveAccessibleBrainIds(
  tenant: TenantReader,
  auth?: AuthSuccess,
): Promise<string[]> {
  const principal = principalAccessFilter(auth);
  if (principal) {
    const brains = await tenant.brain.findMany({ select: { id: true } });
    return brains.map((b) => b.id);
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
 * Validation gate. Personal brains: owner only — validation is the user's
 * own truth claim, no shared editing of that signal. Org brains: any
 * editor or owner — same rule as `canWrite`, since org brains are shared
 * workspaces and validation is part of the shared workflow.
 *
 * Env-var / legacy callers reach here through `resolveBrain` with a
 * synthesized `accessRole: "editor"`. They CAN'T validate personal brains
 * via this helper (editor != owner on personal). For org brains they're
 * treated like any editor — acceptable; the DB boundary already gates
 * cross-org access.
 */
export function canValidate(ctx: BrainContext): boolean {
  if (ctx.brainType === "personal") return ctx.accessRole === "owner";
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
    const byName = new Map<string, BrainContext>(
      accesses.map((a) => [
        a.brain.name,
        {
          brainId: a.brain.id,
          brainName: a.brain.name,
          brainType: a.brain.type,
          accessRole: a.role,
        },
      ]),
    );

    // Org-fallback for human principals: fill any name without explicit
    // BrainAccess by looking up a `type: "org"` brain visible via
    // organization membership (RLS-scoped).
    if (!auth?.agentId) {
      const stillMissing = wanted.filter((n) => !byName.has(n));
      if (stillMissing.length > 0) {
        const orgBrains = await tenant.brain.findMany({
          where: { name: { in: stillMissing }, type: "org" },
        });
        for (const b of orgBrains) {
          byName.set(b.name, {
            brainId: b.id,
            brainName: b.name,
            brainType: b.type,
            accessRole: "editor",
          });
        }
      }
    }

    const missing = wanted.filter((n) => !byName.has(n));
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Brain not found or access denied: ${missing.join(", ")}`,
        },
        { status: 403 },
      );
    }
    return wanted.map((n) => byName.get(n)!);
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
  // Without an explicit BrainAccess row, an authenticated principal can only
  // be reaching this brain through the org-membership fallback. Org brains
  // are shared workspaces, so members default to editor. Env-var callers
  // (no principal) are admin-equivalent and also default to editor.
  const defaultRole = "editor";
  return brains.map((b) => ({
    brainId: b.id,
    brainName: b.name,
    brainType: b.type,
    accessRole: roleById.get(b.id) ?? defaultRole,
  }));
}
