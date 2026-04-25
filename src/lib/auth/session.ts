import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authenticate, isAuthError } from "./bearer";

const SESSION_COOKIE = "aju_session";
const ACTIVE_ORG_COOKIE = "aju_active_org";
const SESSION_LIFETIME_DAYS = 60;
const ACTIVE_ORG_LIFETIME_DAYS = 30;

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function createSession(userId: string, request?: {
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const token = generateToken(32);
  const expiresAt = new Date(
    Date.now() + SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
  );
  const id = generateToken(16);
  await prisma.session.create({
    data: {
      id,
      token,
      userId,
      expiresAt,
      ipAddress: request?.ipAddress ?? null,
      userAgent: request?.userAgent ?? null,
    },
  });
  return { token, expiresAt };
}

/**
 * Resolve the cookie domain scope. `COOKIE_DOMAIN=.aju.sh` in prod lets the
 * cookie flow to `*.aju.sh` subdomains. Unset scopes to the exact host.
 *
 * We defensively reject an env var that doesn't parse as a valid domain
 * suffix — a malformed value would otherwise silently prevent cookies
 * from being accepted by the browser, which shows up as "login doesn't
 * persist" in the UX.
 */
function sessionCookieDomain(): string | undefined {
  const raw = process.env.COOKIE_DOMAIN;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Must look like `.example.com` or `example.com`. Anything else (e.g.
  // a full URL, a path, whitespace) we drop and fall back to host-only.
  if (!/^\.?[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) {
    console.warn(
      `[session] COOKIE_DOMAIN=${JSON.stringify(raw)} looks invalid — ` +
        "falling back to host-only cookie scope",
    );
    return undefined;
  }
  return trimmed;
}

/**
 * Build the base cookie options once so set/clear share the same flags.
 * Only includes `domain` when it's a non-empty string — passing
 * `domain: undefined` to `cookies().set` gets serialized differently by
 * different Next.js versions and can result in a literal `Domain=undefined`
 * that browsers silently reject.
 */
function cookieOptions(extra: {
  expires: Date;
  domain?: string;
}): Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2] {
  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: extra.expires,
  };
  if (extra.domain) {
    return { ...base, domain: extra.domain };
  }
  return base;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  const domain = sessionCookieDomain();
  jar.set(
    SESSION_COOKIE,
    token,
    cookieOptions({ expires: expiresAt, domain }),
  );
}

export async function clearSessionCookie() {
  const jar = await cookies();
  const domain = sessionCookieDomain();
  const inThePast = new Date(0);

  // Always clear the host-only variant to cover cookies set before
  // COOKIE_DOMAIN was configured.
  jar.set(SESSION_COOKIE, "", cookieOptions({ expires: inThePast }));

  // And, when cross-subdomain scope is configured, clear that variant too.
  if (domain) {
    jar.set(
      SESSION_COOKIE,
      "",
      cookieOptions({ expires: inThePast, domain }),
    );
  }
}

export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

/**
 * Resolve the active organization id for the current session.
 *
 * Resolution order:
 *   1. `aju_active_org` cookie, if it names an org the user still has access to
 *   2. The user's `personalOrgId`
 *   3. The user's first membership (by createdAt asc)
 *
 * Returns `null` if there's no signed-in user or no resolvable org.
 */
export async function getActiveOrganizationId(
  _request?: unknown,
): Promise<string | null> {
  const user = await currentUser();
  if (!user) return null;

  const jar = await cookies();
  const cookieOrgId = jar.get(ACTIVE_ORG_COOKIE)?.value ?? null;

  if (cookieOrgId) {
    // Confirm the cookie still points to an org the user can access.
    if (user.personalOrgId && cookieOrgId === user.personalOrgId) {
      return cookieOrgId;
    }
    const membership = await prisma.organizationMembership.findFirst({
      where: { userId: user.id, organizationId: cookieOrgId },
      select: { organizationId: true },
    });
    if (membership) return membership.organizationId;
    // Cookie is stale — fall through to defaults.
  }

  if (user.personalOrgId) return user.personalOrgId;

  const firstMembership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id },
    select: { organizationId: true },
    orderBy: { createdAt: "asc" },
  });

  return firstMembership?.organizationId ?? null;
}

/**
 * Persist the caller's active organization for subsequent requests. The cookie
 * is httpOnly so only the server reads it; we validate it against memberships
 * in `getActiveOrganizationId`.
 */
export async function setActiveOrganizationId(
  organizationId: string,
): Promise<void> {
  const jar = await cookies();
  const expires = new Date(
    Date.now() + ACTIVE_ORG_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
  );
  const domain = sessionCookieDomain();
  jar.set(
    ACTIVE_ORG_COOKIE,
    organizationId,
    cookieOptions({ expires, domain }),
  );
}

export async function clearActiveOrganizationCookie(): Promise<void> {
  const jar = await cookies();
  const domain = sessionCookieDomain();
  const inThePast = new Date(0);
  jar.set(ACTIVE_ORG_COOKIE, "", cookieOptions({ expires: inThePast }));
  if (domain) {
    jar.set(
      ACTIVE_ORG_COOKIE,
      "",
      cookieOptions({ expires: inThePast, domain }),
    );
  }
}

/**
 * Unified principal resolver for API routes.
 *
 * Tries the browser session cookie first; falls back to a bearer API-key on
 * the request. Returns the owning User either way, plus the organization
 * the request should scope to, plus agent/key identifiers when the caller
 * presented an API key.
 *
 * - Session (cookie): organizationId comes from the active-org cookie.
 *   Falls through to personalOrg if unset.
 * - Bearer token (CLI / MCP): organizationId comes from the key's pin
 *   (`ApiKey.organizationId`), falling back to the owner's personal org if
 *   the key is unpinned. `agentId` is set when the key authenticates AS an
 *   agent.
 *
 * Server components without a NextRequest (page.tsx etc.) call with no args
 * and get cookie-only behaviour — same as the previous `currentAuth()`.
 */
export async function currentAuth(req?: NextRequest): Promise<{
  user: User;
  organizationId: string | null;
  agentId?: string;
  apiKeyId?: string;
} | null> {
  // Session cookie takes precedence so a user signed into the dashboard
  // doesn't accidentally act as their saved CLI key if both are present.
  const cookieUser = await currentUser();
  if (cookieUser) {
    const organizationId = await getActiveOrganizationId();
    return { user: cookieUser, organizationId };
  }

  if (!req) return null;

  const bearerAuth = await authenticate(req);
  if (isAuthError(bearerAuth)) return null;
  if (!bearerAuth.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: bearerAuth.userId },
  });
  if (!user) return null;

  const organizationId =
    bearerAuth.organizationId ?? user.personalOrgId ?? null;

  return {
    user,
    organizationId,
    agentId: bearerAuth.agentId,
    apiKeyId: bearerAuth.apiKeyId,
  };
}
