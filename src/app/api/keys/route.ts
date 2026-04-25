import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateApiKey, generateToken } from "@/lib/auth";
import { enforceApiKeysLimit } from "@/lib/billing";
import { authedUserRoute } from "@/lib/route-helpers";

export const runtime = "nodejs";

const ALLOWED_SCOPES = ["read", "write", "admin"] as const;
type Scope = (typeof ALLOWED_SCOPES)[number];

const DEFAULT_SCOPES: Scope[] = ["read", "write"];
const MAX_NAME_LENGTH = 120;
const MAX_EXPIRES_DAYS = 365 * 10; // ten years — effectively no-expiry with a ceiling
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Normalize an unknown `scopes` value coming from the request body. Unknown
 * scopes are rejected outright — we don't want to persist typos that might
 * silently upgrade later if we add more granular scopes.
 */
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

/**
 * The stored `scopes` column is `Json` — Prisma returns it as `unknown`. This
 * narrows it to `string[]` defensively; legacy or malformed values degrade to
 * `DEFAULT_SCOPES` so the UI never breaks on a single bad row.
 */
function normalizeStoredScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string");
  }
  return [...DEFAULT_SCOPES];
}

/**
 * GET /api/keys
 *
 * List the caller's API keys, including revoked ones for audit history. We
 * intentionally expose only `prefix` — never `hash` or plaintext — so a
 * compromised session can't extract a working key.
 */
export const GET = authedUserRoute(async ({ user }) => {
  const rows = await prisma.apiKey.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      prefix: true,
      name: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      organizationId: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    keys: rows.map((k) => ({
      id: k.id,
      prefix: k.prefix,
      name: k.name,
      scopes: normalizeStoredScopes(k.scopes),
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
      expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
      revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
      organizationId: k.organizationId ?? null,
      organization: k.organization
        ? {
            id: k.organization.id,
            name: k.organization.name,
            slug: k.organization.slug,
          }
        : null,
    })),
  };
});

type CreatePayload = {
  name?: string;
  scopes?: unknown;
  expiresInDays?: unknown;
  organizationId?: unknown;
};

/**
 * Resolve which organization a newly-minted key should pin to.
 *
 * Rules:
 *   1. If `organizationId` is supplied in the body, verify the caller is a
 *      member of that org. 403 otherwise.
 *   2. Otherwise fall back to the caller's active org (from currentAuth).
 *   3. Otherwise fall back to the caller's personal org.
 *
 * Result: every minted key is always pinned to exactly one org. No more
 * un-pinned keys that silently route to the personal org at request time.
 */
async function resolveKeyOrg(
  userId: string,
  requested: unknown,
  activeOrgId: string | null,
): Promise<
  | { ok: true; organizationId: string }
  | { ok: false; status: number; error: string }
> {
  if (typeof requested === "string" && requested.trim() !== "") {
    const wanted = requested.trim();
    const membership = await prisma.organizationMembership.findFirst({
      where: { userId, organizationId: wanted },
      select: { organizationId: true },
    });
    if (!membership) {
      return { ok: false, status: 403, error: "not a member of that organization" };
    }
    return { ok: true, organizationId: membership.organizationId };
  }

  if (activeOrgId) {
    return { ok: true, organizationId: activeOrgId };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { personalOrgId: true },
  });
  if (user?.personalOrgId) {
    return { ok: true, organizationId: user.personalOrgId };
  }

  return {
    ok: false,
    status: 400,
    error: "no organization context to pin this key to",
  };
}

/**
 * POST /api/keys
 *
 * Mint a new scoped API key. The plaintext is returned exactly once — callers
 * must persist it immediately. Every key is pinned to an organization: either
 * the one passed as `organizationId` (must be a member), or the caller's
 * active org, or their personal org.
 */
export const POST = authedUserRoute(
  async ({ req, user, organizationId, agentId }) => {
    if (agentId) {
      return NextResponse.json(
        { error: "agent_principals_cannot_mint_keys" },
        { status: 403 },
      );
    }

    // Plan-limit gate: reject if the caller has already hit their non-revoked
    // key cap. Checked before body validation so malformed requests don't
    // accidentally waive the cap via an early 400.
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
    const scopes = scopeResult.scopes;

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

    const orgResult = await resolveKeyOrg(
      user.id,
      body.organizationId,
      organizationId,
    );
    if (!orgResult.ok) {
      return NextResponse.json(
        { error: orgResult.error },
        { status: orgResult.status },
      );
    }

    const { plaintext, prefix, hash } = generateApiKey();

    const created = await prisma.apiKey.create({
      data: {
        id: generateToken(16),
        prefix,
        hash,
        name: rawName,
        userId: user.id,
        scopes,
        expiresAt,
        organizationId: orgResult.organizationId,
      },
      select: {
        id: true,
        prefix: true,
        name: true,
        scopes: true,
        createdAt: true,
        expiresAt: true,
        organizationId: true,
        organization: { select: { id: true, name: true, slug: true } },
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
          organizationId: created.organizationId ?? null,
          organization: created.organization
            ? {
                id: created.organization.id,
                name: created.organization.name,
                slug: created.organization.slug,
              }
            : null,
        },
        plaintext,
        warning:
          "Save this key now. It will not be shown again — if you lose it, revoke this key and create a new one.",
      },
      { status: 201 },
    );
  },
);
