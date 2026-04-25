/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * Advertises the capabilities of aju's built-in OAuth 2.1 authorization
 * server. Claude's Custom Connector fetches this during the "Connect" flow,
 * discovers the registration + authorize + token endpoints, and kicks off
 * dynamic client registration.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveBaseUrl } from "@/lib/auth/oauth/base-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = resolveBaseUrl(req);
  return NextResponse.json(
    {
      // Trailing slash on issuer matches the working reference MCP server.
      // Claude's connector appears to be sensitive to the exact issuer value.
      issuer: `${base}/`,
      authorization_endpoint: `${base}/oauth/authorize`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint: `${base}/oauth/token`,
      token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      // `mcp:tools` is the scope Claude's MCP connector expects. Using
      // generic read/write scopes led to silent token rejection.
      scopes_supported: ["mcp:tools"],
      revocation_endpoint: `${base}/oauth/revoke`,
      revocation_endpoint_auth_methods_supported: ["client_secret_post"],
      registration_endpoint: `${base}/oauth/register`,
    },
    {
      headers: {
        // Metadata is cacheable but should refresh reasonably fast during
        // development.
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
