---
title: Magic-link signup and login
description: The full flow from /api/signup to /api/verify, including the beta cohort cap and waitlist fallback.
order: 20
---

# Magic-link signup and login

There is one signup form and one login form and they are the same form. You type an email; if the address already exists, you get logged in, and if it doesn't, a new user is grandfathered (up to the beta cap) or dropped on the waitlist.

## Flow at a glance

```
[ browser ]                [ /api/signup ]             [ email ]            [ /api/verify ]
    │                            │                         │                       │
    │  POST { email, token }     │                         │                       │
    │──────────────────────────▶ │                         │                       │
    │                            │ Turnstile verify        │                       │
    │                            │ cohort check            │                       │
    │                            │ insert Verification     │                       │
    │                            │ send magic link ──────▶ │                       │
    │  200 { status: "sent" }    │                         │                       │
    │◀───────────────────────────│                         │                       │
    │                            │                         │                       │
    │                            │          user clicks link ─────────────────────▶│
    │                            │                         │                       │ find Verification
    │                            │                         │                       │ begin tx (control DB):
    │                            │                         │                       │   delete Verification
    │                            │                         │                       │   grandfather OR waitlist
    │                            │                         │                       │   create User + personal Org
    │                            │                         │                       │ commit
    │                            │                         │                       │ provisionTenant(orgId)  ← outside tx
    │                            │                         │                       │   (Neon role+DB, migrate, seed brain)
    │                            │                         │                       │ createSession, set cookies
    │  302 /app/onboarding  (or /app/join, or return_to)   │                       │
    │◀─────────────────────────────────────────────────────────────────────────────│
```

## POST /api/signup

Source: `src/app/api/signup/route.ts`.

Input body: `{ email, turnstileToken, returnTo? }`. The handler, in order:

1. **Validates the email** against a basic `[^\s@]+@[^\s@]+\.[^\s@]+` regex (`src/app/api/signup/route.ts:16`). No deliverability check.
2. **Normalizes `returnTo`** via `safeReturnTo`, which only accepts absolute paths and rejects protocol-relative (`//`), backslash-smuggled (`/\`), and scheme-prefixed (`/javascript:`) variants (`src/app/api/signup/route.ts:32`). Anything else is dropped to `null`.
3. **Verifies the Turnstile token** against Cloudflare (`src/app/api/signup/route.ts:70`, see [Turnstile](./turnstile.md)). A failure returns `{ error: "turnstile_failed" }` with status 400.
4. **Runs the cohort check** in parallel with an existing-user lookup (`src/app/api/signup/route.ts:77-80`):
   - count users with `grandfatheredAt IS NOT NULL`
   - find user by email
5. **If the cohort is full and the email is new**, upserts a `WaitlistEntry` and returns `{ status: "waitlisted" }` — no email is sent (`src/app/api/signup/route.ts:82`).
6. **Otherwise**, does a best-effort **domain → org match** via `matchOrgByEmailDomain` (`src/app/api/signup/route.ts:45`). Public email domains (gmail.com, etc.) are skipped; the rest look up the `OrganizationDomain` table for a verified match. This runs `try/catch` and returns `null` on any DB hiccup rather than blocking the signup.
7. **Mints a fresh verification token** (32 random bytes, base64url) with a 30-minute TTL and writes it to the `verification` table, keyed on `value = token` with `identifier = email` (`src/app/api/signup/route.ts:97-106`).
8. **Sends the email** using `magicLinkEmail(email, link)` from `src/lib/email.ts:48`. The link carries `token`, optionally `return_to`, optionally `matched_org`.
9. **Responds `{ status: "sent" }`** — the response shape does not leak whether a matched org was found, so the magic link is the first thing the user sees about it.

### Why a 30-minute TTL

`VERIFICATION_TTL_MIN = 30` (`src/app/api/signup/route.ts:14`). Long enough that the user can dig an email out of a slow inbox or spam folder; short enough that a leaked link from a forwarded email or a screen capture isn't a long-term threat. The token is a 32-byte base64url string (~256 bits of entropy), and it's single-use because `/api/verify` deletes the row inside a transaction before issuing a session.

### Why the IP header fallbacks

`cf-connecting-ip` is populated when we're behind Cloudflare, `x-forwarded-for` when we're behind Railway's proxy. We pick the first non-empty one and hand it to Turnstile as `remoteip`. If neither header is present we pass `null` and Turnstile still works — the IP is an extra signal, not a gate.

## GET /api/verify

Source: `src/app/api/verify/route.ts`.

Query params: `token` (required), `return_to`, `matched_org`.

The handler is structured around one Postgres transaction on the control DB (`aju_control`) that covers the grandfather/waitlist decision plus user/org creation. **Tenant-DB provisioning runs after the tx commits** — a new org needs a fresh Postgres database and that work cannot live inside a control-DB transaction. Everything else is redirects and cookie writes.

1. **Loads the verification row** by `value = token`. No row → `/?error=invalid_token`.
2. **Checks expiry** — if expired, deletes the row and redirects with `/?error=expired_token` (`src/app/api/verify/route.ts:93-96`).
3. **Opens a control-DB transaction** (`src/app/api/verify/route.ts:121`):
   - **Deletes** the verification row (single-use enforcement).
   - If the email already maps to a `User`, returns `{ user, created: false, orgId: user.personalOrgId }`. Login path, no side effects beyond token consumption.
   - Otherwise **re-counts grandfathered users inside the tx** so that two concurrent verifies can't both slip under the cap.
   - If `grandfatheredCount >= COHORT_CAP`, upserts a `WaitlistEntry` and returns `{ waitlisted: true }` without creating the user.
   - Otherwise creates the `User`, an `Organization` with `isPersonal = true`, an `OrganizationMembership` with role `owner`, and back-fills `User.personalOrgId`. The starter `Brain` and `BrainAccess` row are NOT written inside this tx — they live in the per-org tenant DB, which doesn't exist yet.
4. **After the tx commits, calls `provisionTenant(orgId)`** (`src/lib/tenant-provision.ts`). This opens its own Neon API + Postgres connections to create the `org_<cuid>` database, run migrations, seed the default brain, and write the encrypted DSNs into the `Tenant` routing row. It must run outside the control-DB tx because a tx cannot straddle database boundaries.
5. **Provisioning failure is non-fatal**: if `provisionTenant` throws, the user is still signed in and redirected to `/app/onboarding?error=provisioning_failed` (`src/app/api/verify/route.ts:271-273`). The `Organization` row already exists on the control side — the missing tenant DB can be retried from onboarding later. (Known gap: there is no UI banner yet for the `?error=provisioning_failed` query param; the user just lands on onboarding with no tenant DB behind it.)

### The personal-org chicken-and-egg

`User.personalOrgId` references `Organization.id`, and `Organization.ownerUserId` references `User.id`. Both columns are NOT NULL on their owning side. The transaction resolves the cycle like this (`src/app/api/verify/route.ts:137-188`):

1. Create `User` with `personalOrgId = null`.
2. Create `Organization` with `ownerUserId = user.id`.
3. `UPDATE user SET personal_org_id = org.id`.

Slug allocation uses a retry-on-collision loop (up to `SLUG_RETRY_LIMIT = 3`) with a 6-char base36 suffix. The base is `slugify(localPart) || "user"`, so `alice@example.com` becomes something like `alice-a3f9x2`. On Prisma P2002 (unique-constraint violation) we retry; any other error rethrows.

### Post-transaction: provision, session, redirect

On success we:

1. Call `provisionTenant(result.orgId)` if this was a new user (see step 4 above). Failures are caught and flagged in `provisioningError`; the user is still signed in.
2. Call `createSession(userId, { ipAddress, userAgent })` (`src/lib/session.ts:15`), set the `aju_session` cookie, and pin `aju_active_org` to `result.orgId`.
3. Pick a redirect target in this priority order (`src/app/api/verify/route.ts:266-278`):
   - `provisioningError` — redirect to `/app/onboarding?error=provisioning_failed` so the dashboard can surface a retry flow.
   - `return_to` — same-origin deep-link from the signup form (e.g. CLI auth mid-flow).
   - `matched_org` — a verified team domain matched the user's email; send them to `/app/join?org=<slug>`.
   - `/app/onboarding` — default landing for a new user.

## Cohort cap and waitlist

`COHORT_CAP = 100` is hard-coded in both `/api/signup` and `/api/verify`. The cap exists because the beta is deliberately small and the grandfather tier (`planTier = "beta_legacy"`) is a permanent status — these users will have lifetime pricing once paid plans launch. Capping entry is the whole point.

- `/api/signup` checks the cap *before* sending an email, so a full cohort never sees a magic link.
- `/api/verify` re-checks inside the transaction to close the race where two users POST to `/api/signup` while there's exactly one slot left, both get sent a link, and both try to consume it.
- `WaitlistEntry` has a monotonically increasing `position` (BigInt autoincrement, `data/control/schema.prisma`) so we can invite the queue in order when the cohort opens.

The cohort check is specifically `grandfatheredAt IS NOT NULL`, not a plain user count — so seeded admin users or data migrations won't burn slots as long as their `grandfatheredAt` stays null.

## Why magic links at all

- No password surface: no reset flow, no hash-algorithm churn, no credential stuffing blast radius.
- No OAuth provider lock-in during beta.
- It's the lowest-friction flow that still proves control of an email address — and email is the identity the rest of the system keys off (`User.email` is unique, invitation match is case-insensitive on email).

The tradeoff is a dependency on email deliverability and a 30-minute UX window. Both are acceptable at the current scale; neither is irreversible.
