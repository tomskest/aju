/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * Served from /.well-known/oauth-protected-resource/api/mcp (and the unscoped
 * path for compatibility). Points clients at the authorization server that
 * issues tokens for /api/mcp.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveBaseUrl } from "@/lib/auth/oauth/base-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = resolveBaseUrl(req);
  return NextResponse.json(
    {
      resource: `${base}/api/mcp`,
      // Trailing slash on the AS URL matches the issuer in AS metadata.
      authorization_servers: [`${base}/`],
      scopes_supported: ["mcp:tools"],
      resource_name: "aju MCP",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
