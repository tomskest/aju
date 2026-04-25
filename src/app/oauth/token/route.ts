/**
 * POST /oauth/token — token endpoint for the OAuth 2.1 authorization server.
 *
 * Supports:
 *   - grant_type=authorization_code + PKCE (S256). Exchanges the code from
 *     /oauth/authorize for an access token + refresh token pair.
 *   - grant_type=refresh_token. Rotates: old refresh token is revoked, a new
 *     access+refresh pair is issued.
 *
 * Access tokens are stored as `ApiKey` rows with `source="oauth"` so the
 * existing Bearer-token authentication in src/lib/auth.ts accepts them
 * without any further changes. Refresh tokens live on the same row
 * (`refreshTokenPrefix` + `refreshTokenHash`).
 *
 * Per RFC 6749 §3.2, requests are application/x-www-form-urlencoded.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateApiKey } from "@/lib/auth";
import { childLogger } from "@/lib/logger";
import {
  hashSecret,
  randomToken,
  sha256,
  verifyPkceS256,
  verifySecret,
} from "@/lib/auth/oauth/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

// Refresh-token prefix: the literal "aju_refresh_" is already 12 chars, so we
// need to reach further into the random tail to get a unique-enough prefix
// for the unique-index lookup. 20 chars = 8 random base64url chars ≈ 48 bits
// of entropy, which is well clear of birthday-collision range for our scale.
const REFRESH_PREFIX_LEN = 20;

function tokenError(
  error: string,
  description?: string,
  status = 400,
): NextResponse {
  const body: Record<string, string> = { error };
  if (description) body.error_description = description;
  return NextResponse.json(body, {
    status,
    headers: {
      // RFC 6749 §5.2: token endpoint MUST NOT be cached.
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

/**
 * Extract client credentials from either HTTP Basic auth or the request body.
 * Returns null for public clients (no credentials presented).
 */
function extractClientCredentials(
  req: NextRequest,
  body: URLSearchParams,
): { clientId: string; clientSecret: string | null } | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("basic ")) {
    const encoded = authHeader.slice(6).trim();
    let decoded: string;
    try {
      decoded = Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      return null;
    }
    const sep = decoded.indexOf(":");
    if (sep <= 0) return null;
    return {
      clientId: decodeURIComponent(decoded.slice(0, sep)),
      clientSecret: decodeURIComponent(decoded.slice(sep + 1)),
    };
  }

  const bodyClientId = body.get("client_id");
  if (!bodyClientId) return null;
  return {
    clientId: bodyClientId,
    clientSecret: body.get("client_secret"),
  };
}

export async function POST(req: NextRequest) {
  const log = childLogger({ area: "oauth.token", method: req.method });
  const t0 = Date.now();
  const contentType = req.headers.get("content-type") ?? "";
  log.debug(
    {
      contentType,
      has_auth_header: !!req.headers.get("authorization"),
      auth_scheme: req.headers.get("authorization")?.split(" ")[0],
      t: t0,
    },
    "incoming token request",
  );
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
    log.warn({ reason: "wrong_content_type", contentType }, "token request rejected");
    return tokenError(
      "invalid_request",
      "Content-Type must be application/x-www-form-urlencoded.",
    );
  }

  const raw = await req.text();
  const body = new URLSearchParams(raw);
  const grantType = body.get("grant_type");
  log.debug(
    {
      grant_type: grantType,
      client_id: body.get("client_id"),
      has_code: !!body.get("code"),
      has_verifier: !!body.get("code_verifier"),
      has_refresh: !!body.get("refresh_token"),
      redirect_uri: body.get("redirect_uri"),
      resource: body.get("resource"),
    },
    "token body params",
  );

  const creds = extractClientCredentials(req, body);
  if (!creds) {
    log.warn({ reason: "no_client_credentials" }, "token request rejected");
    return tokenError(
      "invalid_client",
      "Missing client_id.",
      401,
    );
  }
  log.debug(
    {
      client_id: creds.clientId,
      has_secret: !!creds.clientSecret,
    },
    "resolved client credentials",
  );

  const client = await prisma.oAuthClient.findUnique({
    where: { clientId: creds.clientId },
  });
  if (!client) {
    log.warn(
      { reason: "unknown_client_id", client_id: creds.clientId },
      "token request rejected",
    );
    return tokenError("invalid_client", "Unknown client_id.", 401);
  }
  log.debug(
    {
      db_id: client.id,
      name: client.clientName,
      auth_method: client.tokenEndpointAuthMethod,
      grant_types: client.grantTypes,
    },
    "found client",
  );

  // Verify the client auth method matches what was registered.
  if (client.tokenEndpointAuthMethod === "none") {
    if (creds.clientSecret) {
      log.warn(
        { reason: "public_client_sent_secret", client_id: creds.clientId },
        "token request rejected",
      );
      return tokenError(
        "invalid_client",
        "This client is registered as public; do not send client_secret.",
        401,
      );
    }
  } else {
    if (!creds.clientSecret || !client.clientSecretHash) {
      log.warn(
        {
          reason: "missing_client_secret",
          client_id: creds.clientId,
          client_sent: !!creds.clientSecret,
          we_have_hash: !!client.clientSecretHash,
        },
        "token request rejected",
      );
      return tokenError("invalid_client", "Missing client_secret.", 401);
    }
    if (!verifySecret(creds.clientSecret, client.clientSecretHash)) {
      log.warn(
        { reason: "client_secret_mismatch", client_id: creds.clientId },
        "token request rejected",
      );
      return tokenError("invalid_client", "Invalid client_secret.", 401);
    }
  }

  if (grantType === "authorization_code") {
    return handleAuthorizationCode(body, client);
  }
  if (grantType === "refresh_token") {
    return handleRefreshToken(body, client);
  }
  log.warn(
    { reason: "unsupported_grant_type", grant_type: grantType },
    "token request rejected",
  );
  return tokenError("unsupported_grant_type", `Unsupported grant_type: ${grantType}`);
}

async function handleAuthorizationCode(
  body: URLSearchParams,
  client: { id: string; grantTypes: string[] },
): Promise<Response> {
  const log = childLogger({ area: "oauth.token", grant: "authorization_code" });
  if (!client.grantTypes.includes("authorization_code")) {
    return tokenError(
      "unauthorized_client",
      "Client is not authorized for grant_type=authorization_code.",
    );
  }

  const code = body.get("code");
  const redirectUri = body.get("redirect_uri");
  const codeVerifier = body.get("code_verifier");
  // RFC 8707: if the authorize request carried `resource`, the token request
  // MUST carry the same value. Tokens are audience-bound on issuance.
  const resource = body.get("resource");

  if (!code || !redirectUri || !codeVerifier) {
    return tokenError(
      "invalid_request",
      "Missing code, redirect_uri, or code_verifier.",
    );
  }

  const codeRow = await prisma.oAuthAuthorizationCode.findUnique({
    where: { codeHash: sha256(code) },
  });
  if (!codeRow) {
    log.warn({ reason: "code_hash_not_found" }, "token request rejected");
    return tokenError("invalid_grant", "Authorization code not recognized.");
  }
  log.debug(
    {
      id: codeRow.id,
      consumed: !!codeRow.consumedAt,
      expired: codeRow.expiresAt.getTime() < Date.now(),
      scope: codeRow.scope,
      stored_redirect_uri: codeRow.redirectUri,
    },
    "found code row",
  );

  // Atomically mark the code consumed. If someone else has raced us, their
  // updatedCount will be 0 and we refuse. Per OAuth 2.1 §4.1.3, a replayed
  // code SHOULD invalidate any tokens previously issued for it — but we
  // haven't issued any yet (we race BEFORE issuing), so refusal is enough.
  if (codeRow.consumedAt != null) {
    // Replay attempt — per OAuth 2.1, if we had issued tokens we should revoke
    // them. We already revoke below if the code is used twice; do it here too
    // as belt-and-braces in case a token was minted by the earlier call.
    await prisma.apiKey
      .updateMany({
        where: {
          source: "oauth",
          oauthClientId: client.id,
          userId: codeRow.userId,
          createdAt: { gte: codeRow.createdAt },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      })
      .catch(() => {});
    return tokenError("invalid_grant", "Authorization code already used.");
  }
  if (codeRow.expiresAt.getTime() < Date.now()) {
    return tokenError("invalid_grant", "Authorization code has expired.");
  }
  if (codeRow.clientId !== client.id) {
    return tokenError(
      "invalid_grant",
      "Authorization code was issued to a different client.",
    );
  }
  if (codeRow.redirectUri !== redirectUri) {
    log.warn(
      {
        reason: "redirect_uri_mismatch",
        stored: codeRow.redirectUri,
        presented: redirectUri,
      },
      "token request rejected",
    );
    return tokenError(
      "invalid_grant",
      "redirect_uri does not match the authorization request.",
    );
  }

  if (codeRow.codeChallengeMethod !== "S256") {
    return tokenError(
      "invalid_grant",
      "Unsupported code_challenge_method on stored code.",
    );
  }
  if (!verifyPkceS256(codeVerifier, codeRow.codeChallenge)) {
    log.warn({ reason: "pkce_verification_failed" }, "token request rejected");
    return tokenError("invalid_grant", "PKCE verification failed.");
  }

  // RFC 8707 §2.2: enforce resource indicator binding. If the authorize
  // request declared a resource, the token request MUST declare the same
  // one. MCP Auth spec mandates this end-to-end.
  if (codeRow.resource) {
    if (!resource) {
      log.warn(
        { reason: "resource_missing", expected: codeRow.resource },
        "token request rejected",
      );
      return tokenError(
        "invalid_target",
        "resource parameter is required; it was declared in the authorize request.",
      );
    }
    if (resource !== codeRow.resource) {
      log.warn(
        {
          reason: "resource_mismatch",
          stored: codeRow.resource,
          presented: resource,
        },
        "token request rejected",
      );
      return tokenError(
        "invalid_target",
        "resource does not match the authorize request.",
      );
    }
  }

  log.debug(
    { audience: codeRow.resource ?? "(unbound)" },
    "authorization_code grant accepted, issuing tokens",
  );

  // Consume the code (single-use).
  const consumed = await prisma.oAuthAuthorizationCode.updateMany({
    where: { id: codeRow.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) {
    return tokenError("invalid_grant", "Authorization code already used.");
  }

  return issueTokenPair({
    userId: codeRow.userId,
    organizationId: codeRow.organizationId,
    clientId: client.id,
    scope: codeRow.scope,
    audience: codeRow.resource,
  });
}

async function handleRefreshToken(
  body: URLSearchParams,
  client: { id: string; grantTypes: string[] },
): Promise<Response> {
  if (!client.grantTypes.includes("refresh_token")) {
    return tokenError(
      "unauthorized_client",
      "Client is not authorized for grant_type=refresh_token.",
    );
  }

  const refreshToken = body.get("refresh_token");
  if (!refreshToken) {
    return tokenError("invalid_request", "Missing refresh_token.");
  }

  const prefix = refreshToken.slice(0, REFRESH_PREFIX_LEN);
  const row = await prisma.apiKey.findUnique({
    where: { refreshTokenPrefix: prefix },
  });
  if (!row || !row.refreshTokenHash || row.oauthClientId !== client.id) {
    return tokenError("invalid_grant", "Refresh token not recognized.");
  }
  if (row.revokedAt != null) {
    return tokenError("invalid_grant", "Refresh token has been revoked.");
  }
  if (row.refreshExpiresAt != null && row.refreshExpiresAt.getTime() < Date.now()) {
    return tokenError("invalid_grant", "Refresh token has expired.");
  }
  if (!verifySecret(refreshToken, row.refreshTokenHash)) {
    return tokenError("invalid_grant", "Refresh token verification failed.");
  }

  // Rotate: revoke the old access+refresh token pair, issue a new one.
  await prisma.apiKey.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });

  const scopeList = Array.isArray(row.scopes)
    ? (row.scopes as unknown[]).filter((s): s is string => typeof s === "string")
    : ["read", "write"];

  return issueTokenPair({
    userId: row.userId,
    organizationId: row.organizationId,
    clientId: client.id,
    scope: scopeList.join(" "),
    audience: row.audience,
  });
}

async function issueTokenPair({
  userId,
  organizationId,
  clientId,
  scope,
  audience,
}: {
  userId: string;
  organizationId: string | null;
  clientId: string;
  scope: string;
  audience: string | null;
}): Promise<Response> {
  const log = childLogger({ area: "oauth.token", stage: "issue" });
  const access = generateApiKey();
  const refreshPlain = `aju_refresh_${randomToken(32)}`;
  const refreshPrefix = refreshPlain.slice(0, REFRESH_PREFIX_LEN);
  const refreshHash = hashSecret(refreshPlain);

  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000);

  const scopes = scope
    .split(/\s+/)
    .filter((s) => s === "mcp:tools" || s === "read" || s === "write");

  log.debug(
    {
      access_prefix: access.prefix,
      user_id: userId,
      organization_id: organizationId,
      scopes,
    },
    "issuing token pair",
  );

  try {
    await prisma.apiKey.create({
      data: {
        id: randomToken(16),
        prefix: access.prefix,
        hash: access.hash,
        name: "oauth",
        userId,
        organizationId: organizationId ?? null,
        source: "oauth",
        oauthClientId: clientId,
        scopes: scopes.length > 0 ? scopes : ["read", "write"],
        expiresAt: accessExpiresAt,
        refreshTokenPrefix: refreshPrefix,
        refreshTokenHash: refreshHash,
        refreshExpiresAt,
        audience,
      },
    });
  } catch (err) {
    log.error(
      { err, user_id: userId, organization_id: organizationId },
      "failed to persist token pair",
    );
    return tokenError(
      "server_error",
      err instanceof Error ? err.message : String(err),
      500,
    );
  }

  const responseBody = {
    access_token: access.plaintext,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refreshPlain,
    scope,
  };
  const json = JSON.stringify(responseBody);

  log.debug(
    {
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SEC,
      scope,
      access_token_len: access.plaintext.length,
      refresh_token_len: refreshPlain.length,
      body_len: json.length,
    },
    "token pair persisted, returning 200",
  );

  // Build the response manually to guarantee exact Content-Type,
  // Content-Length, and cache headers — ruling out NextResponse.json quirks.
  return new Response(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Content-Length": String(Buffer.byteLength(json, "utf8")),
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}
