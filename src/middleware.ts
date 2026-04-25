import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * Edge middleware. Two jobs:
 *
 * 1. Per-IP rate limiting for auth/OAuth/key-minting/upload endpoints. Limits
 *    are per-instance (see src/lib/rate-limit.ts) which is good enough for
 *    current single-instance deploys; horizontal scale-out will want a
 *    Redis-backed replacement.
 * 2. Opt-in per-request debug logger. Dormant by default; set OAUTH_DEBUG=1
 *    to enable during OAuth integration work, then unset.
 */

type Bucket = {
  test: (pathname: string) => boolean;
  name: string;
  limit: number;
  windowSeconds: number;
};

// Order matters: first match wins. Keep exact-match buckets ahead of prefix
// buckets where they overlap.
const BUCKETS: Bucket[] = [
  {
    name: "oauth-authorize",
    test: (p) => p === "/oauth/authorize" || p.startsWith("/oauth/authorize/"),
    limit: 30,
    windowSeconds: 60,
  },
  {
    name: "oauth-token",
    test: (p) => p === "/oauth/token" || p.startsWith("/oauth/token/"),
    limit: 60,
    windowSeconds: 60,
  },
  {
    name: "oauth-register",
    test: (p) => p === "/oauth/register" || p.startsWith("/oauth/register/"),
    limit: 5,
    windowSeconds: 60,
  },
  {
    name: "oauth-revoke",
    test: (p) => p === "/oauth/revoke" || p.startsWith("/oauth/revoke/"),
    limit: 20,
    windowSeconds: 60,
  },
  {
    name: "api-auth",
    test: (p) => p.startsWith("/api/auth/"),
    limit: 20,
    windowSeconds: 60,
  },
  {
    name: "api-keys",
    test: (p) => p === "/api/keys" || p.startsWith("/api/keys/"),
    limit: 10,
    windowSeconds: 60,
  },
  {
    name: "presign-upload",
    test: (p) => p === "/api/vault/files/presign-upload",
    limit: 30,
    windowSeconds: 60,
  },
];

function matchBucket(pathname: string): Bucket | null {
  for (const b of BUCKETS) {
    if (b.test(pathname)) return b;
  }
  return null;
}

export function middleware(req: NextRequest) {
  const url = req.nextUrl;

  // Skip Next.js internals / static assets for both logging and rate limiting.
  if (
    url.pathname.startsWith("/_next") ||
    url.pathname.startsWith("/favicon") ||
    url.pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  if (process.env.OAUTH_DEBUG === "1") {
    // Opt-in per-request trace for OAuth integration work. Middleware runs in
    // Edge runtime so pino isn't available — plain console is correct here.
    // eslint-disable-next-line no-console
    console.log("[req]", {
      method: req.method,
      path: url.pathname,
      query: url.search || undefined,
      hasAuth: !!req.headers.get("authorization"),
      ua: req.headers.get("user-agent")?.slice(0, 80),
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      t: Date.now(),
    });
  }

  const bucket = matchBucket(url.pathname);
  if (bucket) {
    const key = rateLimitKey(req, bucket.name);
    const result = checkRateLimit(key, {
      limit: bucket.limit,
      windowSeconds: bucket.windowSeconds,
    });
    if (!result.allowed) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(result.retryAfterSeconds ?? bucket.windowSeconds),
        },
      });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match everything except Next internals + favicons.
    "/((?!_next/static|_next/image|favicon).*)",
  ],
};
