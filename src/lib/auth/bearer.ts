import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { verifyApiKey } from "./api-key";

/**
 * API-key authentication for the vault routes.
 *
 * Resolution order (first match wins):
 *   1. Authorization: Bearer <aju_live_…|aju_test_…> → look up the ApiKey row
 *      by its 12-char prefix and verify the hash. On success we return the
 *      owning user's identity/email/id plus the apiKeyId that authenticated
 *      the request.
 *   2. Authorization: Bearer <legacy-env-token> → matched against the env-var
 *      key map:
 *
 *        API_KEY=xxx              → identity "admin"
 *        API_KEY_ALICE=yyy        → identity "alice"
 *        API_KEY_OPS=zzz          → identity "ops"
 *        API_KEY_SDR_ENGINE=aaa   → identity "sdr-engine"
 *
 *      Suffix is lowercased and underscores become hyphens.
 *
 * The env-var fallback keeps the single-tenant CLI path functional while the
 * DB-backed keys roll out. Session-based auth for the dashboard lives in
 * src/lib/session.ts.
 */

export type AuthSuccess = {
  identity: string;
  userId?: string;
  email?: string;
  role?: string;
  apiKeyId?: string;
  organizationId?: string;
  // When set, the key authenticates AS this agent. Tenant-DB queries should
  // resolve BrainAccess by agentId rather than userId. `userId` is still
  // present — it's the human who owns/minted the key for audit purposes —
  // but they are not the principal doing this request.
  agentId?: string;
};
export type AuthResult = AuthSuccess | NextResponse;

const DB_KEY_PREFIXES = ["aju_live_", "aju_test_"];
const DB_PREFIX_LEN = 12;

function buildKeyMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [envName, envValue] of Object.entries(process.env)) {
    if (!envValue) continue;
    if (envName === "API_KEY") {
      map.set(envValue, "admin");
    } else if (envName.startsWith("API_KEY_")) {
      const identity = envName
        .slice("API_KEY_".length)
        .toLowerCase()
        .replace(/_/g, "-");
      map.set(envValue, identity);
    }
  }
  return map;
}

let _keyMap: Map<string, string> | null = null;
function getKeyMap(): Map<string, string> {
  if (!_keyMap) _keyMap = buildKeyMap();
  return _keyMap;
}

/**
 * Constant-time lookup in the env-var key map. Avoids short-circuiting on
 * comparison so a token-length side channel doesn't leak whether any key
 * matched.
 */
function lookupEnvKey(token: string): string | null {
  let match: string | null = null;
  const tokenBuf = Buffer.from(token);
  for (const [key, identity] of getKeyMap()) {
    const keyBuf = Buffer.from(key);
    if (keyBuf.length !== tokenBuf.length) continue;
    if (timingSafeEqual(keyBuf, tokenBuf)) {
      match = identity;
    }
  }
  return match;
}

function extractToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }
  return null;
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function looksLikeDbKey(token: string): boolean {
  return DB_KEY_PREFIXES.some((p) => token.startsWith(p));
}

async function authenticateDbKey(token: string): Promise<AuthSuccess | null> {
  const prefix = token.slice(0, DB_PREFIX_LEN);

  let row: Awaited<ReturnType<typeof prisma.apiKey.findUnique>> | null = null;
  try {
    row = await prisma.apiKey.findUnique({ where: { prefix } });
  } catch (err) {
    // Fresh DB before migrations may not have the api_key table yet — let the
    // caller fall through to env-var auth instead of erroring the request.
    console.warn("[auth] api_key lookup failed, falling through:", err);
    return null;
  }

  if (!row) return null;
  if (row.revokedAt != null) return null;
  if (row.expiresAt != null && row.expiresAt.getTime() < Date.now()) {
    return null;
  }

  if (!verifyApiKey(token, row.hash)) return null;

  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user) return null;

  // Fire-and-forget lastUsedAt update — don't block the request on it.
  prisma.apiKey
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    })
    .catch((err) => console.warn("[auth] lastUsedAt update failed:", err));

  // Key-pinned org scopes the request to that org. An un-pinned key carries
  // no org context — BrainAccess rows gate which brains the caller can reach,
  // across any org the user belongs to.
  const organizationId = row.organizationId ?? undefined;
  const agentId = row.agentId ?? undefined;

  return {
    // For agent keys, identity is a synthetic string so audit logs and rate
    // limiters can distinguish the non-human principal from the human owner.
    identity: agentId ? `agent:${agentId}` : user.email,
    userId: user.id,
    email: user.email,
    role: agentId ? "agent" : "member",
    apiKeyId: row.id,
    organizationId,
    agentId,
  };
}

export async function authenticate(req: NextRequest): Promise<AuthResult> {
  const token = extractToken(req);
  if (!token) return unauthorized();

  if (looksLikeDbKey(token)) {
    const dbAuth = await authenticateDbKey(token);
    if (dbAuth) return dbAuth;
    // Explicit DB-style prefix but no match — don't fall back to env vars
    // (env keys don't use those prefixes).
    return unauthorized();
  }

  const identity = lookupEnvKey(token);
  if (identity) {
    return { identity, role: identity === "admin" ? "admin" : "member" };
  }
  return unauthorized();
}

export async function validateKey(key: string): Promise<string | null> {
  return lookupEnvKey(key);
}

export function isAuthError(result: AuthResult): result is NextResponse {
  return result instanceof NextResponse;
}
