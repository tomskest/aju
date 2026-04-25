/**
 * OAuth 2.0 Dynamic Client Registration endpoint (RFC 7591).
 *
 * Open DCR: any caller can register a client. This is the expected shape
 * for MCP-capable hosts like Claude Custom Connectors that can't bootstrap
 * a client_id any other way. Attack surface is limited because a client_id
 * alone grants no access — a human must still consent at /oauth/authorize.
 *
 * Protections:
 *   - Rate-limit registrations per IP (in-memory, per-process). A persistent
 *     rate limiter belongs in Redis but that's overkill for this volume.
 *   - Reject redirect_uris with non-https schemes (except http://localhost
 *     and http://127.0.0.1 for local dev clients).
 *   - Clamp client_name length and strip control characters.
 *   - Require at least one redirect_uri.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { hashSecret, randomToken } from "@/lib/auth/oauth/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REDIRECT_URIS = 10;
const MAX_NAME_LEN = 200;
const MAX_URI_LEN = 2000;

// Very small in-memory IP rate limiter: 20 registrations per hour per IP.
// Process-local; resets on deploy. Enough to blunt a casual flood.
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 20;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function rateLimitAllow(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || entry.resetAt < now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function registrationError(
  error: string,
  description: string,
  status = 400,
): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status },
  );
}

function isValidRedirectUri(raw: string): boolean {
  if (raw.length > MAX_URI_LEN) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // No fragments per RFC 6749 §3.1.2.
  if (url.hash) return false;

  if (url.protocol === "https:") return true;

  // Allow http only for loopback addresses (dev tooling, native apps that
  // bind to a local port). RFC 8252 §7.3 explicitly blesses this.
  if (url.protocol === "http:") {
    const host = url.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  }

  // Allow custom schemes (native apps) — they must contain a period to avoid
  // clashing with reserved schemes; RFC 8252 §7.1 recommends reverse-DNS.
  if (url.protocol.endsWith(":") && url.protocol.includes(".")) {
    return true;
  }

  return false;
}

function sanitizeName(raw: unknown): string {
  const s =
    typeof raw === "string" && raw.trim().length > 0
      ? raw.trim()
      : "Unknown client";
  return s
    .replace(/[\u0000-\u001f\u007f]/g, "") // strip control chars
    .slice(0, MAX_NAME_LEN);
}

export async function POST(req: NextRequest) {
  const log = childLogger({ area: "oauth.register", method: req.method });
  const ip = clientIp(req);
  if (!rateLimitAllow(ip)) {
    return registrationError(
      "temporarily_unavailable",
      "Too many registrations from this source. Try again later.",
      429,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return registrationError("invalid_client_metadata", "Body must be JSON.");
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? (body.redirect_uris as unknown[]).filter(
        (u): u is string => typeof u === "string",
      )
    : [];

  if (redirectUris.length === 0) {
    return registrationError(
      "invalid_redirect_uri",
      "At least one redirect_uri is required.",
    );
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    return registrationError(
      "invalid_redirect_uri",
      `A client may register at most ${MAX_REDIRECT_URIS} redirect URIs.`,
    );
  }
  for (const uri of redirectUris) {
    if (!isValidRedirectUri(uri)) {
      return registrationError(
        "invalid_redirect_uri",
        `Rejected redirect_uri: ${uri}`,
      );
    }
  }

  // token_endpoint_auth_method — per RFC 7591, defaults to
  // "client_secret_basic". We accept "none" (public clients, PKCE-only) as
  // well as the two client-secret variants. Anything else is rejected.
  const authMethod =
    typeof body.token_endpoint_auth_method === "string"
      ? body.token_endpoint_auth_method
      : "client_secret_basic";
  const allowedAuthMethods = new Set([
    "none",
    "client_secret_basic",
    "client_secret_post",
  ]);
  if (!allowedAuthMethods.has(authMethod)) {
    return registrationError(
      "invalid_client_metadata",
      `Unsupported token_endpoint_auth_method: ${authMethod}`,
    );
  }

  // grant_types — we only support authorization_code + refresh_token.
  const grantTypes = Array.isArray(body.grant_types)
    ? (body.grant_types as unknown[]).filter((g): g is string => typeof g === "string")
    : ["authorization_code", "refresh_token"];
  const allowedGrants = new Set(["authorization_code", "refresh_token"]);
  for (const g of grantTypes) {
    if (!allowedGrants.has(g)) {
      return registrationError(
        "invalid_client_metadata",
        `Unsupported grant_type: ${g}`,
      );
    }
  }

  // response_types — only "code" is supported (authorization code flow).
  const responseTypes = Array.isArray(body.response_types)
    ? (body.response_types as unknown[]).filter(
        (r): r is string => typeof r === "string",
      )
    : ["code"];
  for (const r of responseTypes) {
    if (r !== "code") {
      return registrationError(
        "invalid_client_metadata",
        `Unsupported response_type: ${r}. Only "code" is supported.`,
      );
    }
  }

  const clientName = sanitizeName(body.client_name);
  const clientUri =
    typeof body.client_uri === "string" && body.client_uri.length <= MAX_URI_LEN
      ? body.client_uri
      : null;
  const logoUri =
    typeof body.logo_uri === "string" && body.logo_uri.length <= MAX_URI_LEN
      ? body.logo_uri
      : null;
  const softwareId =
    typeof body.software_id === "string" ? body.software_id.slice(0, 200) : null;
  const softwareVersion =
    typeof body.software_version === "string"
      ? body.software_version.slice(0, 200)
      : null;

  // Scope: accept whatever the client requests, but intersect with what we
  // actually issue. `mcp:tools` is the canonical MCP-facing scope.
  const requestedScopeStr =
    typeof body.scope === "string" ? body.scope : "mcp:tools";
  const allowedScopes = new Set(["mcp:tools"]);
  const scope = requestedScopeStr
    .split(/\s+/)
    .filter((s) => allowedScopes.has(s))
    .join(" ") || "mcp:tools";

  const clientId = `aju_client_${randomToken(16)}`;
  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;
  if (authMethod !== "none") {
    clientSecret = randomToken(32);
    clientSecretHash = hashSecret(clientSecret);
  }

  log.debug(
    {
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      auth_method: authMethod,
      scope,
      ip,
    },
    "registering client",
  );

  const row = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecretHash,
      clientName,
      redirectUris,
      grantTypes,
      tokenEndpointAuthMethod: authMethod,
      scope,
      clientUri,
      logoUri,
      softwareId,
      softwareVersion,
      registeredByIp: ip,
    },
  });
  log.debug(
    {
      client_id: row.clientId,
      has_secret: !!clientSecret,
    },
    "client issued",
  );

  // Minimal DCR response matching the working MCP SDK reference. The SDK
  // deliberately omits `grant_types`, `response_types`,
  // `token_endpoint_auth_method`, `scope`, and any `registration_*` fields;
  // Claude's connector validator is strict about what it accepts.
  const response: Record<string, unknown> = {
    redirect_uris: row.redirectUris,
    client_name: row.clientName,
    client_id: row.clientId,
    client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
  };
  if (clientSecret) {
    response.client_secret = clientSecret;
    // Year 2100 epoch — the MCP SDK treats 0 as "expired at epoch", not "never
    // expires" as RFC 7591 §3.2.1 intends. A far-future timestamp sidesteps
    // the SDK bug while still being spec-compliant.
    response.client_secret_expires_at = 4102444800;
  }

  return NextResponse.json(response, { status: 201 });
}
