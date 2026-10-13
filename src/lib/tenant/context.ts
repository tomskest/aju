/**
 * Tenant request scoping.
 *
 * Two entry points:
 *
 *   - `withBrainContext(client, brainIds, fn)` — opens a transaction on a
 *     tenant client, sets `app.current_brain_ids` to the given list, then
 *     runs `fn` with the transaction. RLS policies in the tenant DB read
 *     this session variable to filter rows by brain_id.
 *
 *   - `withTenant(req, fn)` — the higher-level helper for API routes.
 *     Resolves the user + orgId from the request, fetches the tenant client,
 *     computes the accessible brain ids, and hands the transaction to `fn`.
 *
 * RLS policies are the tenant DB's enforcement layer; the DB itself is the
 * organization boundary. Every policy allows rows when `app.current_brain_ids`
 * is unset, so maintenance paths (provisioning, migrations, per-tenant jobs)
 * can still read/write without scoping. HTTP request paths MUST go through
 * `withBrainContext` / `withTenant`.
 */

import { Prisma } from "@prisma/client-tenant";
import { prisma, tenantDbFor, type PrismaClientTenant } from "@/lib/db";

type TenantTx = Prisma.TransactionClient;

const BRAIN_ID_PATTERN = /^[a-z0-9]+$/;

function assertValidBrainId(brainId: string): void {
  if (typeof brainId !== "string" || brainId.length === 0) {
    throw new Error("withBrainContext: brainId must be a non-empty string");
  }
  if (!BRAIN_ID_PATTERN.test(brainId)) {
    throw new Error(
      `withBrainContext: brainId contains invalid characters: ${brainId}`,
    );
  }
}

function formatBrainIds(brainIds: readonly string[]): string {
  for (const id of brainIds) assertValidBrainId(id);
  return brainIds.join(",");
}

/**
 * Run `fn` inside a tenant-client transaction that has
 * `app.current_brain_ids` pinned to the given list. RLS policies referencing
 * `current_setting('app.current_brain_ids', true)` will resolve against this
 * list for the lifetime of the transaction.
 *
 * An empty `brainIds` list still sets the variable (to an empty string) so
 * the "unset" escape branch does NOT fire — callers with no brain access
 * get zero rows, not all rows.
 */
export async function withBrainContext<T>(
  client: PrismaClientTenant,
  brainIds: readonly string[],
  fn: (tx: TenantTx) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return client.$transaction(
    async (tx) => {
      await setBrainContextOnTx(tx, brainIds);
      return fn(tx);
    },
    opts.timeoutMs ? { timeout: opts.timeoutMs, maxWait: opts.timeoutMs } : undefined,
  );
}

// From Postgres 16 a role's creator is a member of it with ADMIN but without
// SET, so MEMBER is true even where SET ROLE would be refused. Ask for SET
// there; before 16, MEMBER is the right to SET ROLE.
const canSetRole = Prisma.sql`CASE WHEN current_setting('server_version_num')::int >= 160000 THEN 'SET' ELSE 'MEMBER' END`;

/**
 * Apply the brain-context session variable to an already-open transaction.
 * Useful when composing multiple writes inside a `client.$transaction` the
 * caller already owns and wants to stamp the var once up front.
 *
 * Uses `set_config(name, value, is_local)` so the value travels as a bound
 * parameter — `SET LOCAL ... = $1` is not legal Postgres because SET only
 * accepts literal expressions. Empty list maps to a sentinel so the RLS
 * policy's "unset escape" branch does NOT fire (which would widen access).
 *
 * It also drops the transaction to the tenant's RLS role, `<login role>_rls`.
 * The login role is created through the Neon API, which gives it BYPASSRLS,
 * so without the switch no policy ever applies. The `_rls` role has no
 * BYPASSRLS, and data/tenant/rls-policies.sql creates it and makes the login
 * role a member. `set_config('role', …, true)` is SET LOCAL ROLE, so it ends
 * with the transaction and never outlives it on a pooled connection. Where
 * the role does not exist yet, or membership was revoked, nothing switches.
 * SKIP_TENANT_RLS_ROLE=1 turns the switch off everywhere.
 */
export async function setBrainContextOnTx(
  tx: TenantTx,
  brainIds: readonly string[],
): Promise<void> {
  const joined = formatBrainIds(brainIds);
  const value = joined.length === 0 ? "__none__" : joined;
  const switchRole =
    process.env.SKIP_TENANT_RLS_ROLE === "1"
      ? Prisma.empty
      : Prisma.sql`, (
          SELECT set_config('role', r.rolname, true)
          FROM pg_roles r
          WHERE r.rolname = current_user || '_rls'
            AND pg_has_role(current_user, r.oid, ${canSetRole})
        )`;
  await tx.$executeRaw`SELECT set_config('app.current_brain_ids', ${value}, true)${switchRole}`;
}

/**
 * Run `fn` with the brain filter lifted, inside a transaction that is
 * otherwise scoped to the caller's brains. For reads that are org-wide by
 * definition, such as the storage quota pooled across every brain, which
 * the caller's own view would undercount. The previous setting is restored
 * afterwards, so an unscoped transaction stays unscoped.
 */
export async function withOrgWideRead<T>(
  tx: TenantTx,
  fn: () => Promise<T>,
): Promise<T> {
  const [{ prev }] = await tx.$queryRaw<Array<{ prev: string | null }>>`
    SELECT current_setting('app.bypass_rls', true) AS prev`;
  await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
  try {
    return await fn();
  } finally {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', ${prev ?? ""}, true)`;
  }
}

/**
 * Resolve the tenant client for an org and list the brain ids the given
 * user (or agent) can see. This is the read side that feeds withBrainContext.
 *
 * Human members of `orgId` get implicit editor access to every `type: "org"`
 * brain in the tenant, in addition to any explicit BrainAccess grants.
 * Personal brains stay private — only their owners (or anyone with an
 * explicit BrainAccess row) see them. Agent principals never get the
 * fallback: agents only see brains explicitly granted to them.
 */
export async function resolveTenantAccess(
  orgId: string,
  actor: { userId?: string; agentId?: string },
): Promise<{ tenant: PrismaClientTenant; brainIds: string[] }> {
  if (!actor.userId && !actor.agentId) {
    throw new Error("resolveTenantAccess: need userId or agentId");
  }
  const tenant = await tenantDbFor(orgId);

  // Agent principal takes priority over user: a key that represents an
  // agent should see the agent's BrainAccess grants, not the owning user's.
  // For human-only keys (agentId unset) we fall through to userId.
  const where = actor.agentId
    ? { agentId: actor.agentId }
    : { userId: actor.userId };

  const rows = await tenant.brainAccess.findMany({
    where,
    select: { brainId: true },
  });
  const ids = new Set(rows.map((r) => r.brainId));

  if (actor.userId && !actor.agentId) {
    const membership = await prisma.organizationMembership.findFirst({
      where: { userId: actor.userId, organizationId: orgId },
      select: { id: true },
    });
    if (membership) {
      const orgBrains = await tenant.brain.findMany({
        where: { type: "org" },
        select: { id: true },
      });
      for (const b of orgBrains) ids.add(b.id);
    }
  }

  return { tenant, brainIds: [...ids] };
}

/**
 * High-level tenant request scope.
 *
 * Resolves the tenant client for `organizationId`, computes the brain ids
 * the given user/agent can access, and runs `fn` inside a transaction with
 * `app.current_brain_ids` pinned. This is the default entry point for API
 * routes and server components that touch tenant tables.
 *
 * When `unscoped: true` is passed, skips the brain-id lookup and runs the
 * callback without a SET LOCAL — useful for admin maintenance paths and for
 * org-create flows that must write seed data before any BrainAccess rows
 * exist. The `unscoped: true` path trusts the caller to enforce org scoping
 * some other way (typically because the DB boundary already does it).
 */
export async function withTenant<T>(
  params: {
    organizationId: string;
    userId?: string;
    agentId?: string;
    unscoped?: boolean;
    /**
     * Interactive-transaction timeout override in ms. Prisma's default is
     * 5000ms, which is too short for long-running operations like reindex
     * (Voyage embedding batch + UPDATEs + link rebuild on a brain with many
     * docs). Set this when the handler is expected to exceed 5s; otherwise
     * Prisma will roll back the transaction mid-handler and downstream calls
     * starve on the connection pool.
     */
    timeoutMs?: number;
  },
  fn: (ctx: {
    tenant: PrismaClientTenant;
    tx: TenantTx;
    brainIds: readonly string[];
  }) => Promise<T>,
): Promise<T> {
  if (params.unscoped) {
    const tenant = await tenantDbFor(params.organizationId);
    return tenant.$transaction(
      async (tx) => {
        // Deliberate, transaction-local RLS bypass for maintenance paths
        // (provisioning, brain-create seed writes, agent management on
        // tables without brain_id, etc.). Pairs with the bypass clause in
        // data/tenant/rls-policies.sql. Setting `is_local=true` ensures
        // the bypass releases when the transaction commits or aborts —
        // it cannot leak across requests on a pooled connection.
        //
        // Without this opt-in the policies fail closed: forgetting to
        // scope = zero rows visible, which is the inversion of the
        // earlier `IS NULL OR ...` permissive default.
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        return fn({ tenant, tx, brainIds: [] });
      },
      params.timeoutMs
        ? { timeout: params.timeoutMs, maxWait: params.timeoutMs }
        : undefined,
    );
  }
  const { tenant, brainIds } = await resolveTenantAccess(params.organizationId, {
    userId: params.userId,
    agentId: params.agentId,
  });
  return withBrainContext(
    tenant,
    brainIds,
    async (tx) => fn({ tenant, tx, brainIds }),
    { timeoutMs: params.timeoutMs },
  );
}
