import type { NextRequest } from "next/server";

/**
 * Resolve the canonical base URL the OAuth server should advertise (issuer,
 * endpoint URLs, resource URIs). All OAuth metadata URLs MUST match exactly
 * between discovery documents and redirect targets, or clients will reject
 * them per RFC 8414 §3.3.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_APP_URL — set in deployed environments.
 *   2. Forwarded host + proto headers — handles Railway's edge proxy.
 *   3. The raw request URL origin — last-resort fallback for local dev.
 */
export function resolveBaseUrl(req: NextRequest | Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;

  const headers = req.headers;
  const forwardedHost = headers.get("x-forwarded-host") ?? headers.get("host");
  const forwardedProto = headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(req.url).origin;
}
