import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateApiKey, generateToken } from "@/lib/auth";
import { enforceApiKeysLimit } from "@/lib/billing";
import { authedUserRoute } from "@/lib/route-helpers";
import { clientIp, recordAudit } from "@/lib/audit";
import {
  apiKeyScopeSchema,
  cuidSchema,
  nameSchema,
  validateBody,
} from "@/lib/validators";

export const runtime = "nodejs";

type Scope = z.infer<typeof apiKeyScopeSchema>;

const DEFAULT_SCOPES: Scope[] = ["read", "write"];
const MAX_EXPIRES_DAYS = 365 * 10; // ten years — effectively no-expiry with a ceiling
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Preset → scope-array mapping. UI sends `preset`; raw `scopes` arrays still
// accepted for power users / programmatic clients. If both are sent, `scopes`
// wins (explicit beats convenience).
const presetSchema = z.enum(["reader", "editor", "operator", "owner"]);
type Preset = z.infer<typeof presetSchema>;
const SCOPE_PRESETS: Record<Preset, Scope[]> = {
  reader: ["read"],
  editor: ["read", "write"],
  operator: ["read", "write", "delete"],
  owner: ["read", "write", "delete", "admin"],
};

const createKeySchema = z.object({
  name: nameSchema,
  preset: presetSchema.optional(),
  scopes: z
    .array(apiKeyScopeSchema)
    .optional()
    // Drop duplicates while keeping insertion order. Empty after dedup → defaults.
    .transform((s) => (s ? [...new Set(s)] : undefined)),
  expiresInDays: z.number().int().positive().max(MAX_EXPIRES_DAYS).optional(),
  organizationId: cuidSchema.optional(),
});

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
  requested: string | undefined,
  activeOrgId: string | null,
): Promise<
  | { ok: true; organizationId: string }
  | { ok: false; status: number; error: string }
> {
  if (requested) {
    const membership = await prisma.organizationMembership.findFirst({
      where: { userId, organizationId: requested },
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
  async ({ req, user, organizationId, agentId, apiKeyId }) => {
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

    const validation = await validateBody(req, createKeySchema);
    if (!validation.ok) return validation.response;
    const {
      name,
      preset,
      scopes: requestedScopes,
      expiresInDays,
      organizationId: requestedOrgId,
    } = validation.value;

    const scopes =
      requestedScopes && requestedScopes.length > 0
        ? requestedScopes
        : preset
          ? SCOPE_PRESETS[preset]
          : DEFAULT_SCOPES;

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * MS_PER_DAY)
      : null;

    const orgResult = await resolveKeyOrg(
      user.id,
      requestedOrgId,
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
        name,
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

    await recordAudit(prisma, {
      eventType: "key.minted",
      actorUserId: user.id,
      actorApiKeyId: apiKeyId ?? null,
      organizationId: orgResult.organizationId,
      resourceType: "apikey",
      resourceId: created.id,
      changes: {
        name,
        scopes,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      ipAddress: clientIp(req),
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
  { requiresScope: "admin" },
);
