import { NextRequest, NextResponse } from "next/server";

/**
 * Post-auth navigation helpers.
 *
 * `return_to` is accepted on the landing page, on magic-link verification,
 * and on the org switch route. All three need the same open-redirect guard
 * and the same proxy-aware redirect base, so they live here rather than
 * being re-typed per caller.
 */

/**
 * Accepts either a same-origin path (starting with `/`) or a full HTTPS URL
 * whose host ends in `.aju.sh` (e.g. `https://mcp.aju.sh/authorize?...`).
 * External hosts are rejected so a malicious `?return_to=...` can't turn a
 * sign-in or an org switch into an open redirect.
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;

  if (raw.startsWith("/")) {
    if (raw.startsWith("//")) return null;
    if (raw.startsWith("/\\")) return null;
    if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (host === "aju.sh" || host.endsWith(".aju.sh")) {
      return parsed.toString();
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Same as `safeReturnTo` but rejects cross-subdomain URLs outright. Used
 * where the destination must stay inside the app itself, so a redirect can
 * never carry a freshly-pinned session cookie somewhere else.
 */
export function safeReturnToPath(raw: string | null | undefined): string | null {
  const value = safeReturnTo(raw);
  return value && value.startsWith("/") ? value : null;
}

/**
 * Redirect helper for route handlers. Prefers the public app URL over
 * req.url, because behind Railway's reverse proxy req.url is the internal
 * origin (localhost:8080), which breaks redirects.
 */
export function appRedirect(req: NextRequest, path: string): NextResponse {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (() => {
      const forwardedHost = req.headers.get("x-forwarded-host");
      const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
      if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
      return new URL(req.url).origin;
    })();
  return NextResponse.redirect(new URL(path, base));
}
