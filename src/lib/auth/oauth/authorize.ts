/**
 * Shared validation + helpers for the /oauth/authorize flow.
 *
 * Used by both the page (to decide what to render) and the approve route
 * (to make sure we're issuing a code against exactly the same parameters
 * the user saw on the consent screen).
 */
import { prisma } from "@/lib/db";
import type { OAuthClient } from "@prisma/client";

export type AuthorizeParams = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  // RFC 8707 Resource Indicator — the MCP resource the token will be used
  // against. MCP Auth spec mandates the client sends this. We echo it
  // through the flow so the token is audience-bound.
  resource: string | null;
};

export type AuthorizeValidation =
  | { ok: true; client: OAuthClient; params: AuthorizeParams }
  | {
      ok: false;
      // "client-visible" errors are redirected back to the client with the
      // `error` query param. "user-visible" errors can't be — either the
      // client is unknown or the redirect_uri doesn't match, so we render
      // a page instead.
      kind: "user-visible" | "client-visible";
      error: string;
      errorDescription: string;
      // Populated for client-visible errors so the caller can 302 correctly.
      redirectUri?: string;
      state?: string | null;
    };

const ALLOWED_SCOPES = new Set(["mcp:tools"]);

export function parseAuthorizeParams(
  search: URLSearchParams,
): AuthorizeParams {
  return {
    responseType: search.get("response_type") ?? "",
    clientId: search.get("client_id") ?? "",
    redirectUri: search.get("redirect_uri") ?? "",
    scope: (search.get("scope") ?? "mcp:tools").trim(),
    state: search.get("state"),
    codeChallenge: search.get("code_challenge") ?? "",
    codeChallengeMethod: search.get("code_challenge_method") ?? "",
    resource: search.get("resource"),
  };
}

export async function validateAuthorizeParams(
  params: AuthorizeParams,
): Promise<AuthorizeValidation> {
  // 1) Client lookup — a missing/unknown client_id is user-visible: we can't
  //    safely redirect anywhere.
  if (!params.clientId) {
    return {
      ok: false,
      kind: "user-visible",
      error: "invalid_request",
      errorDescription: "Missing client_id.",
    };
  }
  const client = await prisma.oAuthClient.findUnique({
    where: { clientId: params.clientId },
  });
  if (!client) {
    return {
      ok: false,
      kind: "user-visible",
      error: "invalid_client",
      errorDescription: "Unknown client_id.",
    };
  }

  // 2) redirect_uri exact match — also user-visible. An attacker could only
  //    reach this point by controlling a *valid* URI the client pre-registered.
  if (!params.redirectUri) {
    return {
      ok: false,
      kind: "user-visible",
      error: "invalid_request",
      errorDescription: "Missing redirect_uri.",
    };
  }
  if (!client.redirectUris.includes(params.redirectUri)) {
    return {
      ok: false,
      kind: "user-visible",
      error: "invalid_request",
      errorDescription: "redirect_uri does not match any registered URI.",
    };
  }

  // From here, errors can safely redirect back to the client.
  const redirectInfo = {
    redirectUri: params.redirectUri,
    state: params.state,
  };

  if (params.responseType !== "code") {
    return {
      ok: false,
      kind: "client-visible",
      error: "unsupported_response_type",
      errorDescription: "Only response_type=code is supported.",
      ...redirectInfo,
    };
  }

  if (!params.codeChallenge) {
    return {
      ok: false,
      kind: "client-visible",
      error: "invalid_request",
      errorDescription: "PKCE code_challenge is required.",
      ...redirectInfo,
    };
  }
  if (params.codeChallengeMethod && params.codeChallengeMethod !== "S256") {
    return {
      ok: false,
      kind: "client-visible",
      error: "invalid_request",
      errorDescription:
        "Only code_challenge_method=S256 is supported.",
      ...redirectInfo,
    };
  }

  // Scope: filter to allowed values; if nothing survives, fail.
  const requested = params.scope
    .split(/\s+/)
    .filter((s) => s.length > 0);
  const filtered = requested.filter((s) => ALLOWED_SCOPES.has(s));
  if (requested.length > 0 && filtered.length === 0) {
    return {
      ok: false,
      kind: "client-visible",
      error: "invalid_scope",
      errorDescription: `Unknown scope: ${requested.join(" ")}`,
      ...redirectInfo,
    };
  }
  const normalizedScope = (filtered.length > 0 ? filtered : ["mcp:tools"]).join(" ");

  return {
    ok: true,
    client,
    params: {
      ...params,
      scope: normalizedScope,
      codeChallengeMethod: params.codeChallengeMethod || "S256",
    },
  };
}

/**
 * Build an error redirect URL per RFC 6749 §4.1.2.1. Preserves `state`.
 */
export function buildErrorRedirect(
  redirectUri: string,
  error: string,
  errorDescription: string,
  state: string | null | undefined,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", errorDescription);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export function buildSuccessRedirect(
  redirectUri: string,
  code: string,
  state: string | null | undefined,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
