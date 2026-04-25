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

import type { Prisma as PrismaTenant } from "@prisma/client-tenant";
import { tenantDbFor, type PrismaClientTenant } from "@/lib/db";

type TenantTx = PrismaTenant.TransactionClient;

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

/**
 * Apply the brain-context session variable to an already-open transaction.
 * Useful when composing multiple writes inside a `client.$transaction` the
 * caller already owns and wants to stamp the var once up front.
 *
 * Uses `set_config(name, value, is_local)` so the value travels as a bound
 * parameter — `SET LOCAL ... = $1` is not legal Postgres because SET only
 * accepts literal expressions. Empty list maps to a sentinel so the RLS
 * policy's "unset escape" branch does NOT fire (which would widen access).
 */
export async function setBrainContextOnTx(
  tx: TenantTx,
  brainIds: readonly string[],
): Promise<void> {
  const joined = formatBrainIds(brainIds);
  const value = joined.length === 0 ? "__none__" : joined;
  await tx.$executeRaw`SELECT set_config('app.current_brain_ids', ${value}, true)`;
}

/**
 * Resolve the tenant client for an org and list the brain ids the given
 * user (or agent) can see. This is the read side that feeds withBrainContext.
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
  const brainIds = [...new Set(rows.map((r) => r.brainId))];
  return { tenant, brainIds };
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
      async (tx) => fn({ tenant, tx, brainIds: [] }),
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
