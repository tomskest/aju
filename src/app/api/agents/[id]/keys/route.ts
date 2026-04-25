import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { currentAuth, generateToken } from "@/lib/auth";
import { enforceApiKeysLimit } from "@/lib/billing";
import { generateApiKey } from "@/lib/auth";
import { canManageMembers, type OrgRole } from "@/lib/tenant";

export const runtime = "nodejs";

/**
 * Agent-scoped API keys.
 *
 * An agent is a non-human principal stored in one tenant DB. A key minted
 * against an agent authenticates AS the agent — BrainAccess filters by
 * `agent_id` rather than `user_id`, so the caller sees only the grants the
 * agent has been given.
 *
 * The minting `user_id` on `ApiKey` is still the human who clicked "create
 * key" (for audit + admin revocation). The ownership dimension and the
 * principal dimension are deliberately separate.
 */

type RouteContext = { params: Promise<{ id: string }> };

function unauthorized() {
  return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

type Scope = "read" | "write" | "admin";
const ALLOWED_SCOPES: readonly Scope[] = ["read", "write", "admin"] as const;
const DEFAULT_SCOPES: Scope[] = ["read", "write"];
const MAX_NAME_LENGTH = 120;
const MAX_EXPIRES_DAYS = 365 * 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseScopes(
  raw: unknown,
): { ok: true; scopes: Scope[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, scopes: DEFAULT_SCOPES };
  if (!Array.isArray(raw)) return { ok: false, error: "scopes must be an array" };

  const out: Scope[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      return { ok: false, error: "scopes must be strings" };
    }
    const lower = entry.trim().toLowerCase();
    if (!ALLOWED_SCOPES.includes(lower as Scope)) {
      return { ok: false, error: `unknown scope: ${entry}` };
    }
    if (!out.includes(lower as Scope)) out.push(lower as Scope);
  }
  if (out.length === 0) return { ok: true, scopes: DEFAULT_SCOPES };
  return { ok: true, scopes: out };
}

function normalizeStoredScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string");
  }
  return [...DEFAULT_SCOPES];
}

/**
 * Assert the caller is an owner/admin of the org the agent lives in, and
 * that the agent itself exists and isn't revoked. The caller supplies the
 * resolved org (from `currentAuth(req)`) so bearer auth can use its
 * key-pinned org instead of the cookie-derived active org.
 */
async function assertAgentAdmin(
  agentId: string,
  userId: string,
  organizationId: string | null,
): Promise<
  | { ok: true; organizationId: string }
  | { ok: false; response: NextResponse }
> {
  if (!organizationId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "no_active_org" }, { status: 400 }),
    };
  }
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, organizationId },
    select: { role: true },
  });
  if (!membership) return { ok: false, response: forbidden() };
  if (!canManageMembers(membership.role as OrgRole)) {
    return { ok: false, response: forbidden() };
  }

  const agent = await withTenant(
    { organizationId, userId, unscoped: true },
    async ({ tx }) =>
      tx.agent.findFirst({
        where: { id: agentId },
        select: { id: true, status: true },
      }),
  );
  if (!agent) return { ok: false, response: notFound() };
  if (agent.status === "revoked") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "agent_revoked" },
        { status: 400 },
      ),
    };
  }
  return { ok: true, organizationId };
}

/**
 * GET /api/agents/[id]/keys
 *
 * List keys for a specific agent. Owner/admin of the agent's org only.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  const { user, organizationId } = auth;
  const { id: agentId } = await ctx.params;

  const check = await assertAgentAdmin(agentId, user.id, organizationId);
  if (!check.ok) return check.response;

  const rows = await prisma.apiKey.findMany({
    where: { agentId, organizationId: check.organizationId },
    select: {
      id: true,
      prefix: true,
      name: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      userId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    keys: rows.map((k) => ({
      id: k.id,
      prefix: k.prefix,
      name: k.name,
      scopes: normalizeStoredScopes(k.scopes),
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
      expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
      revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
      mintedByUserId: k.userId,
    })),
  });
}

type CreatePayload = {
  name?: string;
  scopes?: unknown;
  expiresInDays?: unknown;
};

/**
 * POST /api/agents/[id]/keys
 *
 * Mint a new key that authenticates as the agent. Plaintext is returned
 * exactly once — the caller must persist it immediately.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_mint_agent_keys" },
      { status: 403 },
    );
  }
  const { user, organizationId } = auth;
  const { id: agentId } = await ctx.params;

  const check = await assertAgentAdmin(agentId, user.id, organizationId);
  if (!check.ok) return check.response;

  // Agent keys count against the minter's apiKeysMax cap (matches the
  // usage page, which sums both user-keys and agent-keys by userId).
  const limitErr = await enforceApiKeysLimit(user.id);
  if (limitErr) return limitErr;

  const body = (await req.json().catch(() => ({}))) as CreatePayload;

  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (!rawName) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (rawName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  }

  const scopeResult = parseScopes(body.scopes);
  if (!scopeResult.ok) {
    return NextResponse.json({ error: scopeResult.error }, { status: 400 });
  }

  let expiresAt: Date | null = null;
  if (body.expiresInDays != null) {
    const days = Number(body.expiresInDays);
    if (!Number.isFinite(days) || !Number.isInteger(days) || days <= 0) {
      return NextResponse.json(
        { error: "expiresInDays must be a positive integer" },
        { status: 400 },
      );
    }
    if (days > MAX_EXPIRES_DAYS) {
      return NextResponse.json(
        { error: "expiresInDays too large" },
        { status: 400 },
      );
    }
    expiresAt = new Date(Date.now() + days * MS_PER_DAY);
  }

  const { plaintext, prefix, hash } = generateApiKey();

  const created = await prisma.apiKey.create({
    data: {
      id: generateToken(16),
      prefix,
      hash,
      name: rawName,
      userId: user.id,
      agentId,
      organizationId: check.organizationId,
      scopes: scopeResult.scopes,
      expiresAt,
    },
    select: {
      id: true,
      prefix: true,
      name: true,
      scopes: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  return NextResponse.json(
    {
      key: {
        id: created.id,
        prefix: created.prefix,
        name: created.name,
        scopes: normalizeStoredScopes(created.scopes),
        createdAt: created.createdAt.toISOString(),
        expiresAt: created.expiresAt ? created.expiresAt.toISOString() : null,
        agentId,
      },
      plaintext,
      warning:
        "Save this key now. It will not be shown again — revoke and create a new one if lost.",
    },
    { status: 201 },
  );
}
