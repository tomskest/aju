---
title: Session management
description: How aju_session and aju_active_org cookies work, with full lifecycle and rotation rules.
order: 30
---

# Session management

Source: `src/lib/session.ts`.

Sessions back the dashboard (`/app/**`) and anything else the browser calls without an API key. They are **opaque random tokens**, stored in a `Session` row and echoed to the browser in an httpOnly cookie. There are no JWTs. There is no signed payload. A session is valid if and only if the token in the cookie matches a non-expired row in the database.

## Two cookies

| Cookie | Purpose | Lifetime | HttpOnly | Secure (prod) | SameSite |
|---|---|---|---|---|---|
| `aju_session` | Session identifier (maps to a `Session` row) | 60 days | yes | yes | lax |
| `aju_active_org` | Which org the user is currently viewing | 30 days | yes | yes | lax |

Constants live at the top of `src/lib/session.ts`:

```ts
const SESSION_COOKIE = "aju_session";
const ACTIVE_ORG_COOKIE = "aju_active_org";
const SESSION_LIFETIME_DAYS = 60;
const ACTIVE_ORG_LIFETIME_DAYS = 30;
```

Both cookies are httpOnly — client JS can't read them, which rules out exfiltration via XSS on the dashboard. They are `secure` only in production (`NODE_ENV === "production"`); local dev over HTTP still works. `sameSite: "lax"` permits top-level navigations (magic-link redirects, OAuth-style CLI device flow) but blocks cross-site POSTs.

## Creating a session

`createSession(userId, { ipAddress, userAgent })` — `src/lib/session.ts:15`.

- `token = randomBytes(32).toString("base64url")` — 256 bits of entropy.
- `id = randomBytes(16).toString("base64url")` — 128-bit primary key, independent of the token so we can delete a session by ID without leaking the token.
- `expiresAt = now + 60 days`.
- IP and UA are persisted for audit. They are **not** enforced — a stolen token still works from another IP. The audit trail exists so a user can see where their sessions live, not so the server can second-guess them.

`setSessionCookie(token, expiresAt)` writes the cookie with the same expiry.

## Reading the current user

`currentUser()` — `src/lib/session.ts:53`.

```ts
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
```

Every server component, every API route, every `/app/**` page that needs auth calls `currentUser()`. It is the single chokepoint for "is this request logged in?".

**Lazy cleanup**: an expired session is deleted the moment someone tries to use it, wrapped in `.catch(() => {})` so a concurrent delete race doesn't blow up the request. There is no background job sweeping expired sessions — the volume is too low to matter, and every expired session costs exactly one failed lookup to resolve.

### Why `token` not `id` as the lookup key

`Session.token` is marked `@unique` (`prisma/schema.prisma:225`). The primary key `id` exists but the cookie carries `token` specifically so that an attacker with read access to the `Session` table's `id` column but not the `token` column can't impersonate anyone. In practice both columns live in the same row and same database, so this is a belt-and-braces choice — the real protection is that `token` has 256 bits of entropy and is not logged anywhere.

## Signing out

`POST /api/auth/signout` — `src/app/api/auth/signout/route.ts`.

```ts
await clearSessionCookie();
await clearActiveOrganizationCookie();
return NextResponse.redirect(new URL("/", base), { status: 303 });
```

`clearSessionCookie()` deletes the cookie from the browser. Note: the corresponding `Session` row is **not** deleted on sign-out — it stays until `expiresAt` lapses and the next `currentUser()` call sweeps it. This is a deliberate simplification; the row is otherwise inert, and the cookie being gone means nothing can re-authenticate with the old token anyway.

> TODO: verify — consider whether this matters for a "sign out everywhere" feature. As of this writing the app has no UI to enumerate or revoke sessions beyond clearing the current cookie.

The redirect base URL prefers `NEXT_PUBLIC_APP_URL` because behind Railway's reverse proxy `req.url` resolves to the internal `localhost:8080` origin (`src/app/api/auth/signout/route.ts:11`). The same pattern repeats in `/api/verify`.

## Active organization resolution

`getActiveOrganizationId()` — `src/lib/session.ts:81`.

A user can belong to multiple orgs (their auto-created personal org plus any team they've joined or created). The "active" org is the scope for everything they see on the dashboard: which brains show in the sidebar, which org the Create-Brain button targets, which tenant DB is opened for every read and write.

Because each organization has its own Postgres database, the active-org cookie is not just a UI preference — it **selects which tenant DB** the server connects to for the rest of the request. `getActiveOrganizationId()` → `tenantDbFor(orgId)` → a `PrismaClientTenant` bound to `org_<cuid>`. Switching the cookie is the only way the browser crosses the DB boundary; a single HTTP response never touches more than one tenant DB.

Resolution order:

1. **`aju_active_org` cookie**, if it names an org the user can still access.
   - If the cookie equals `user.personalOrgId`, accept it immediately without a DB round-trip.
   - Otherwise check `OrganizationMembership` for `(userId, organizationId)`. A miss means the cookie is stale (user was removed from the org, org was deleted, or a session from another user somehow carries the wrong cookie); fall through.
2. **`user.personalOrgId`**, if set — new users always have one, but the column is nullable to handle the transient state during signup.
3. **First membership by `createdAt ASC`** — deterministic fallback for users whose personal org was deleted but who still belong to at least one team org.
4. **null** — no org resolvable. The UI shows a "no organization selected" state.

`setActiveOrganizationId(organizationId)` writes the cookie with a 30-day lifetime (`src/lib/session.ts:119`). The route `POST /api/orgs/[id]/switch` (`src/app/api/orgs/[id]/switch/route.ts`) is the public entry point; it verifies membership first and returns 404 if the caller isn't a member — same existence-hiding as `GET /api/orgs/[id]`. CLI and MCP clients do not use this cookie; they switch orgs by presenting a different API key (keys are pinned to exactly one org — see [API keys](./api-keys.md)).

### Why the active-org cookie is httpOnly

It's only ever read server-side to resolve tenant scope. Making it httpOnly closes off any client-side JS confusion where an XSS could force a user into a different org than the one they're looking at. The server re-validates it against memberships on every read, so even if the cookie were forgeable, the user would only ever see orgs they actually belong to.

## `currentAuth()` — both in one call

`currentAuth(): { user, organizationId } | null` composes the two lookups into one awaited result (`src/lib/session.ts:145`). Added without replacing `currentUser()` — existing call sites keep working; new code that needs both grabs them together.

## How routes enforce sessions

There is **no Next.js middleware** in this repo. Authentication is enforced at two layers:

- **Server components under `/app/**`** call `currentUser()` at the top of the layout (`src/app/app/layout.tsx:14-17`). A missing user triggers `redirect("/")` before any child renders.
- **API routes** call `currentUser()` or (for bearer-auth routes) `authenticate(req)` from `src/lib/auth.ts` and return 401 on miss. There is no shared auth wrapper; each route is explicit about which auth path it accepts.

This keeps the control flow obvious at the cost of repetition. A middleware could centralize it, but the server-component redirect pattern plus explicit API-route checks was chosen for readability and to make it trivial to run a single route with different auth rules.
