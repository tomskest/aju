/**
 * POST /oauth/revoke — RFC 7009 Token Revocation.
 *
 * Accepts either an access token or a refresh token. We look the token up
 * in ApiKey (OAuth-issued rows) and mark it revoked.
 *
 * Per RFC 7009 §2.2, successful revocation responds with 200. Invalid tokens
 * also produce a 200 response (to prevent token enumeration). Only bad
 * request shape or unauthorized clients return errors.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyApiKey } from "@/lib/auth";
import { childLogger } from "@/lib/logger";
import { verifySecret } from "@/lib/auth/oauth/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function successResponse(): NextResponse {
  return NextResponse.json(
    {},
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

function errorResponse(
  error: string,
  description?: string,
  status = 400,
): NextResponse {
  const body: Record<string, string> = { error };
  if (description) body.error_description = description;
  return NextResponse.json(body, { status });
}

async function authenticateClient(
  req: NextRequest,
  body: URLSearchParams,
): Promise<{ id: string } | "invalid"> {
  const authHeader = req.headers.get("authorization");
  let clientId: string | null = null;
  let clientSecret: string | null = null;

  if (authHeader?.toLowerCase().startsWith("basic ")) {
    const encoded = authHeader.slice(6).trim();
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep > 0) {
        clientId = decodeURIComponent(decoded.slice(0, sep));
        clientSecret = decodeURIComponent(decoded.slice(sep + 1));
      }
    } catch {
      // fall through
    }
  } else {
    clientId = body.get("client_id");
    clientSecret = body.get("client_secret");
  }

  if (!clientId) return "invalid";
  const client = await prisma.oAuthClient.findUnique({
    where: { clientId },
  });
  if (!client) return "invalid";

  if (client.tokenEndpointAuthMethod === "none") {
    if (clientSecret) return "invalid";
    return { id: client.id };
  }

  if (!clientSecret || !client.clientSecretHash) return "invalid";
  if (!verifySecret(clientSecret, client.clientSecretHash)) return "invalid";
  return { id: client.id };
}

export async function POST(req: NextRequest) {
  const log = childLogger({ area: "oauth.revoke", method: req.method });
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
    return errorResponse(
      "invalid_request",
      "Content-Type must be application/x-www-form-urlencoded.",
    );
  }

  const raw = await req.text();
  const body = new URLSearchParams(raw);

  const client = await authenticateClient(req, body);
  if (client === "invalid") {
    return errorResponse("invalid_client", "Client authentication failed.", 401);
  }

  const token = body.get("token");
  if (!token) {
    return errorResponse("invalid_request", "Missing token.");
  }
  const hint = body.get("token_type_hint");

  log.debug(
    {
      client_db_id: client.id,
      hint,
      has_token: true,
    },
    "incoming revoke request",
  );

  // Try access token first (by prefix) unless hint says otherwise.
  if (hint !== "refresh_token") {
    const accessPrefix = token.slice(0, 12);
    const accessRow = await prisma.apiKey.findUnique({
      where: { prefix: accessPrefix },
    });
    if (
      accessRow &&
      accessRow.oauthClientId === client.id &&
      verifyApiKey(token, accessRow.hash)
    ) {
      await prisma.apiKey.update({
        where: { id: accessRow.id },
        data: { revokedAt: new Date() },
      });
      log.debug({ api_key_id: accessRow.id }, "revoked access token");
      return successResponse();
    }
  }

  // Try refresh token (by its longer prefix).
  const refreshPrefix = token.slice(0, 20);
  const refreshRow = await prisma.apiKey.findUnique({
    where: { refreshTokenPrefix: refreshPrefix },
  });
  if (
    refreshRow &&
    refreshRow.oauthClientId === client.id &&
    refreshRow.refreshTokenHash &&
    verifySecret(token, refreshRow.refreshTokenHash)
  ) {
    await prisma.apiKey.update({
      where: { id: refreshRow.id },
      data: { revokedAt: new Date() },
    });
    log.debug({ api_key_id: refreshRow.id }, "revoked refresh token");
    return successResponse();
  }

  // Per RFC 7009 §2.2: unknown token → still 200. Don't leak which tokens
  // we know about.
  log.debug({ client_db_id: client.id }, "unknown token, returning 200 anyway");
  return successResponse();
}
