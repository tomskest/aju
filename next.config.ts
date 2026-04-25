import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next's file-tracing doesn't drift up to
  // /Users/<me>/ when a stray lockfile exists outside the repo. Matters for
  // `.next/standalone` output on Railway — without this, runtime deps can be
  // silently omitted.
  outputFileTracingRoot: import.meta.dirname,
  serverExternalPackages: ["pg", "pdf-parse"],
  async rewrites() {
    return [
      // OAuth 2.0 Authorization Server Metadata (RFC 8414)
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth/well-known/authorization-server",
      },
      // OAuth 2.0 Protected Resource Metadata (RFC 9728). Scoped to the MCP
      // endpoint so clients discovering from /api/mcp land here.
      {
        source: "/.well-known/oauth-protected-resource/api/mcp",
        destination: "/api/oauth/well-known/protected-resource",
      },
      // Some clients (including older Claude revisions) probe the unscoped path.
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/oauth/well-known/protected-resource",
      },
    ];
  },
};

export default nextConfig;
