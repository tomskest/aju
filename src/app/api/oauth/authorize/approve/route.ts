/**
 * POST /api/oauth/authorize/approve — consumes the consent-screen decision.
 *
 * On approve: mint a single-use authorization code bound to (client, user,
 * org, redirect_uri, PKCE challenge, scope) with a 10-minute TTL. The code
 * is hashed (SHA-256) at rest; only the plaintext is returned, embedded in
 * the redirect URL the client navigates to.
 *
 * On deny: redirect back to the client with error=access_denied (RFC 6749
 * §4.1.2.1) so the client can clean up its UI.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import {
  buildErrorRedirect,
  buildSuccessRedirect,
  parseAuthorizeParams,
  validateAuthorizeParams,
} from "@/lib/auth/oauth/authorize";
import { randomToken, sha256 } from "@/lib/auth/oauth/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_TTL_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Re-run the exact same validation the page did, so a tampered approval
  // request can't smuggle in different params.
  const search = new URLSearchParams({
    response_type: "code",
    client_id: String(body.client_id ?? ""),
    redirect_uri: String(body.redirect_uri ?? ""),
    scope: String(body.scope ?? ""),
    state: String(body.state ?? ""),
    code_challenge: String(body.code_challenge ?? ""),
    code_challenge_method: String(body.code_challenge_method ?? "S256"),
  });
  const resourceParam =
    typeof body.resource === "string" && body.resource.length > 0
      ? body.resource
      : null;
  if (resourceParam) search.set("resource", resourceParam);
  const validation = await validateAuthorizeParams(parseAuthorizeParams(search));
  if (!validation.ok) {
    if (validation.kind === "client-visible" && validation.redirectUri) {
      return NextResponse.json({
        redirect_url: buildErrorRedirect(
          validation.redirectUri,
          validation.error,
          validation.errorDescription,
          validation.state,
        ),
      });
    }
    return NextResponse.json(
      { error: validation.error, error_description: validation.errorDescription },
      { status: 400 },
    );
  }

  const { client, params } = validation;
  const action = body.action === "deny" ? "deny" : "approve";

  if (action === "deny") {
    return NextResponse.json({
      redirect_url: buildErrorRedirect(
        params.redirectUri,
        "access_denied",
        "User declined the authorization request.",
        params.state,
      ),
    });
  }

  const organizationId = await getActiveOrganizationId();

  const code = randomToken(32);
  const codeHash = sha256(code);
  await prisma.oAuthAuthorizationCode.create({
    data: {
      codeHash,
      clientId: client.id,
      userId: user.id,
      organizationId: organizationId ?? null,
      redirectUri: params.redirectUri,
      scope: params.scope,
      resource: params.resource,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  return NextResponse.json({
    redirect_url: buildSuccessRedirect(
      params.redirectUri,
      code,
      params.state,
    ),
  });
}
