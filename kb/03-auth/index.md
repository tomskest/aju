---
title: Authentication, API keys, and organizations
description: How users sign in, how CLIs and MCP clients authenticate, and how multi-tenant org membership works.
order: 30
---

# Authentication, API keys, and organizations

aju has three distinct authentication paths that share one user table:

1. **Magic-link sessions** for the dashboard at `aju.sh` — cookie-based, browser only.
2. **API keys** for the CLI, MCP server, and any HTTP client — `Authorization: Bearer aju_live_…`.
3. **Legacy env-var keys** (`API_KEY`, `API_KEY_<IDENTITY>`) for single-tenant self-hosted deployments that predate the DB-backed key path.

Underneath, every authenticated request resolves to a `User` row and (for the DB-backed paths) a single active `Organization`. Users, sessions, and API keys live in a control-plane database (`aju_control`). Tenant data lives in a separate Postgres database per organization (`org_<cuid>`), reached via the `Tenant` routing table. There is no password and — by design — no JWT. Sessions and keys are opaque random tokens looked up in Postgres; key secrets are stored hashed, session tokens are not. (OAuth 2.1 exists as an authorization-server layer that mints API keys — see [API keys](./api-keys.md).)

The sections below cover each path in the order a new signup actually encounters them:

1. [Magic-link signup and login](./magic-links.md) — `/api/signup` → email → `/api/verify` → session cookie, plus the beta cohort cap and waitlist fallback.
2. [Turnstile bot protection](./turnstile.md) — how the Cloudflare widget gates signup submissions, and why it fails open in dev.
3. [Session management](./sessions.md) — `aju_session` and `aju_active_org` cookies, `currentUser()`, rotation, and expiry.
4. [API keys](./api-keys.md) — minting, scopes, scrypt hashing, the `aju_live_` prefix, the mandatory organization pin, and how the CLI and MCP server present them.
5. [CLI device-code flow](./cli-device-flow.md) — how `aju login` exchanges a user code for an API key without ever seeing the user's session.
6. [Organizations, roles, and invitations](./organizations.md) — personal vs. team orgs, per-org tenant DBs and the `Tenant` routing table, owner/admin/member hierarchy, domain claims, invitation tokens, and the public-email blocklist.

## Sources

Everything in this section is derived from the routes and helpers under:

- `src/app/api/signup/**`
- `src/app/api/verify/**`
- `src/app/api/auth/**`
- `src/app/api/keys/**`
- `src/app/api/orgs/**`
- `src/app/api/invitations/**`
- `src/lib/session.ts`
- `src/lib/auth.ts`
- `src/lib/api-key.ts`
- `src/lib/email.ts`
- `src/lib/turnstile.ts`
- `src/lib/public-email-blocklist.ts`
- `src/lib/tenant-types.ts`
- `src/lib/tenant-context.ts` (`withBrainContext`, `withTenant`)
- `src/lib/tenant-provision.ts` (`provisionTenant`)
- `data/control/schema.prisma` (control-plane `aju_control`: `User`, `Session`, `Account`, `Verification`, `ApiKey`, `DeviceCode`, `Organization`, `OrganizationMembership`, `OrganizationDomain`, `Invitation`, `AccessRequest`, `WaitlistEntry`, `Tenant`, `OAuth*`)
- `data/tenant/schema.prisma` (per-org `org_<cuid>`: `Brain`, `BrainAccess`, documents, etc.)

There is no Next.js middleware — `/app/**` routes are guarded by a server-side `currentUser()` check inside `src/app/app/layout.tsx`, which redirects unauthenticated callers to `/`.
