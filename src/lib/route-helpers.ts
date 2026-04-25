/**
 * Route helpers — fold the per-route auth + org + membership + withTenant
 * boilerplate into one place.
 *
 * Before:
 *   export async function GET(req) {
 *     const auth = await authenticate(req);
 *     if (isAuthError(auth)) return auth;
 *     // …resolve organizationId fallbacks…
 *     // …membership.findFirst…
 *     return withTenant(…, async ({ tx }) => { … });
 *   }
 *
 * After:
 *   export const GET = authedTenantRoute(async ({ tx, principal, brainIds }) => {
 *     // …handler body…
 *     return { … };
 *   });
 *
 * Each helper resolves the principal via `currentAuth` (cookie or bearer),
 * checks org membership, optionally enforces a minimum role, and (for tenant
 * routes) opens a tenant transaction with brain-id RLS already scoped. The
 * handler returns a NextResponse or any JSON-serializable value.
 */

import { NextRequest, NextResponse } from "next/server";
import type { User } from "@prisma/client";
import type {
  Prisma as PrismaTenant,
  PrismaClient as PrismaClientTenant,
} from "@prisma/client-tenant";
import type { AuthSuccess } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import type { OrgRole } from "@/lib/tenant";

type TenantTx = PrismaTenant.TransactionClient;

const ROLE_RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

function unauthorized() {
  return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function noActiveOrg() {
  return NextResponse.json({ error: "no_active_org" }, { status: 400 });
}

/**
 * Coerce the handler's return value into a NextResponse. Handlers may either
 * build the response themselves (e.g. for non-200 cases) or return any JSON-
 * serializable value, which we wrap in a 200.
 */
function toResponse(result: unknown): NextResponse {
  if (result instanceof NextResponse) return result;
  return NextResponse.json(
    result as Parameters<typeof NextResponse.json>[0] ?? {},
  );
}

/** Build an AuthSuccess-shaped principal from currentAuth's resolved auth. */
function asAuthSuccess(args: {
  user: User;
  organizationId: string;
  role: OrgRole;
  agentId?: string;
  apiKeyId?: string;
}): AuthSuccess {
  return {
    identity: args.agentId ? `agent:${args.agentId}` : args.user.email,
    userId: args.user.id,
    email: args.user.email,
    role: args.role,
    apiKeyId: args.apiKeyId,
    organizationId: args.organizationId,
    agentId: args.agentId,
  };
}

// ─── Tenant routes ──────────────────────────────────────────────────────────

export type TenantHandlerCtx<TParams = Record<string, never>> = {
  req: NextRequest;
  user: User;
  organizationId: string;
  role: OrgRole;
  agentId?: string;
  apiKeyId?: string;
  /**
   * AuthSuccess-shaped principal — pass straight to brain helpers
   * (`resolveBrain`, `resolveBrainIds`, `resolveAccessibleBrainIds`) which
   * still take the bearer-style auth argument.
   */
  principal: AuthSuccess;
  tenant: PrismaClientTenant;
  tx: TenantTx;
  brainIds: readonly string[];
  params: TParams;
};

export type TenantHandlerOpts = {
  /** Minimum role required (default: "member"). */
  minRole?: OrgRole;
  /**
   * Skip brain-id RLS scoping. The org-DB boundary still scopes per-org —
   * use this for admin/maintenance endpoints touching tables without a
   * brain_id column (e.g. agent management).
   */
  unscoped?: boolean;
  /** Override the interactive-transaction timeout. */
  timeoutMs?: number;
};

/**
 * Wrap a tenant-scoped route handler. Resolves auth + active org + membership
 * (with optional role gate), opens a tenant transaction with RLS pinned to
 * the caller's accessible brains, and forwards the context.
 */
export function authedTenantRoute<TParams = Record<string, never>>(
  handler: (ctx: TenantHandlerCtx<TParams>) => Promise<unknown>,
  opts: TenantHandlerOpts = {},
): (
  req: NextRequest,
  routeCtx: { params: Promise<TParams> },
) => Promise<NextResponse> {
  const minRole: OrgRole = opts.minRole ?? "member";

  return async (req, routeCtx) => {
    const auth = await currentAuth(req);
    if (!auth) return unauthorized();

    const { user, organizationId, agentId, apiKeyId } = auth;
    if (!organizationId) return noActiveOrg();

    const membership = await prisma.organizationMembership.findFirst({
      where: { userId: user.id, organizationId },
      select: { role: true },
    });
    if (!membership) return forbidden();

    const role = membership.role as OrgRole;
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) return forbidden();

    const params = (await routeCtx.params) as TParams;
    const principal = asAuthSuccess({ user, organizationId, role, agentId, apiKeyId });

    return withTenant(
      {
        organizationId,
        userId: user.id,
        agentId,
        unscoped: opts.unscoped,
        timeoutMs: opts.timeoutMs,
      },
      async ({ tenant, tx, brainIds }) => {
        try {
          const result = await handler({
            req,
            user,
            organizationId,
            role,
            agentId,
            apiKeyId,
            principal,
            tenant,
            tx,
            brainIds,
            params,
          });
          return toResponse(result);
        } catch (err) {
          console.error(
            `[authedTenantRoute ${req.method} ${req.nextUrl.pathname}]`,
            err,
          );
          return NextResponse.json({ error: "internal_error" }, { status: 500 });
        }
      },
    );
  };
}

// ─── User-only routes (no tenant DB) ────────────────────────────────────────

export type UserHandlerCtx<TParams = Record<string, never>> = {
  req: NextRequest;
  user: User;
  /** Active org from cookie/bearer pin; null if the user has no active org. */
  organizationId: string | null;
  agentId?: string;
  apiKeyId?: string;
  params: TParams;
};

/**
 * Wrap a route that only needs a signed-in user, without org/tenant scoping.
 * Useful for self-service endpoints (e.g. listing the user's own API keys,
 * exporting their own data).
 */
export function authedUserRoute<TParams = Record<string, never>>(
  handler: (ctx: UserHandlerCtx<TParams>) => Promise<unknown>,
): (
  req: NextRequest,
  routeCtx: { params: Promise<TParams> },
) => Promise<NextResponse> {
  return async (req, routeCtx) => {
    const auth = await currentAuth(req);
    if (!auth) return unauthorized();

    const params = (await routeCtx.params) as TParams;

    try {
      const result = await handler({
        req,
        user: auth.user,
        organizationId: auth.organizationId,
        agentId: auth.agentId,
        apiKeyId: auth.apiKeyId,
        params,
      });
      return toResponse(result);
    } catch (err) {
      console.error(
        `[authedUserRoute ${req.method} ${req.nextUrl.pathname}]`,
        err,
      );
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  };
}

// ─── Org-management routes (control DB, with membership check) ──────────────

export type OrgHandlerCtx<TParams = Record<string, never>> = {
  req: NextRequest;
  user: User;
  organizationId: string;
  role: OrgRole;
  apiKeyId?: string;
  params: TParams;
};

export type OrgHandlerOpts = {
  /** Minimum role required (default: "member"). */
  minRole?: OrgRole;
  /**
   * If set, the helper resolves `organizationId` from `params[orgIdKey]`
   * (typically a route segment like `/api/orgs/[id]/...`) and verifies the
   * caller is a member of that org. Otherwise the active org is used.
   */
  orgIdParam?: string;
};

/**
 * Wrap an org-scoped route that doesn't open a tenant transaction. Resolves
 * the org id (either from a route param or the active-org context), checks
 * membership + role, and forwards the context. Use for control-plane reads/
 * writes (members, invitations, domains, access requests).
 */
export function authedOrgRoute<TParams = Record<string, never>>(
  handler: (ctx: OrgHandlerCtx<TParams>) => Promise<unknown>,
  opts: OrgHandlerOpts = {},
): (
  req: NextRequest,
  routeCtx: { params: Promise<TParams> },
) => Promise<NextResponse> {
  const minRole: OrgRole = opts.minRole ?? "member";

  return async (req, routeCtx) => {
    const auth = await currentAuth(req);
    if (!auth) return unauthorized();

    // Agents don't have org roles — they carry per-brain access grants in
    // the tenant DB. Org-management routes are human-only.
    if (auth.agentId) {
      return NextResponse.json(
        { error: "agent_principals_cannot_manage_orgs" },
        { status: 403 },
      );
    }

    const { user, apiKeyId } = auth;
    const params = (await routeCtx.params) as TParams;

    let organizationId: string | null = auth.organizationId;
    if (opts.orgIdParam) {
      const fromParam = (params as Record<string, unknown>)[opts.orgIdParam];
      if (typeof fromParam === "string" && fromParam.length > 0) {
        organizationId = fromParam;
      }
    }
    if (!organizationId) return noActiveOrg();

    const membership = await prisma.organizationMembership.findFirst({
      where: { userId: user.id, organizationId },
      select: { role: true },
    });
    if (!membership) return forbidden();

    const role = membership.role as OrgRole;
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) return forbidden();

    try {
      const result = await handler({
        req,
        user,
        organizationId,
        role,
        apiKeyId,
        params,
      });
      return toResponse(result);
    } catch (err) {
      console.error(
        `[authedOrgRoute ${req.method} ${req.nextUrl.pathname}]`,
        err,
      );
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  };
}
