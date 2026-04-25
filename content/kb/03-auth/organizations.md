---
title: Organizations, roles, and invitations
description: Personal vs. team orgs, the owner/admin/member hierarchy, domain claims, invitation tokens, and the public-email blocklist.
order: 60
---

# Organizations, roles, and invitations

Every user has at least one organization. Personal orgs exist for solo use; team orgs exist for collaboration. They are the same `Organization` model with an `isPersonal` flag and slightly different lifecycle rules.

**Each organization owns its own Postgres database.** The `Organization` row lives in the control plane (`aju_control`) alongside users, memberships, invitations, and API keys; everything tenant-scoped — brains, documents, embeddings, audit logs — lives in a dedicated `org_<cuid>` database. A `Tenant` row in the control DB routes `organizationId` to its tenant DSN. This is the strongest isolation primitive the app has: no cross-org query can be written because no single connection reaches more than one org's data.

## The data model

Two schemas, two database roles.

**Control plane** — `prisma/control/schema.prisma`, DB name `aju_control`:

```
User ──▶ personalOrg: Organization (nullable, unique)
User ◀── ownedOrgs: Organization[]             (1:N)
User ◀── memberships: OrganizationMembership[] (N:N bridge)
User ◀── apiKeys: ApiKey[]       (each key pinned to exactly one Organization)

Organization
  ├── memberships: OrganizationMembership[]
  ├── invitations: Invitation[]
  ├── domains: OrganizationDomain[]
  ├── accessRequests: AccessRequest[]
  ├── apiKeys: ApiKey[]          (ApiKey.organizationId is required)
  ├── deviceCodes: DeviceCode[]
  └── tenant: Tenant?            (1:1 — the routing row for the org's DB)

Tenant                            (the routing table)
  ├── organizationId (unique)
  ├── databaseName: "org_<cuid>"
  ├── dsnDirectEnc / dsnPooledEnc (AES-GCM, key = TENANT_DSN_ENC_KEY)
  ├── schemaVersion / lastMigratedAt
  └── status: "provisioning" | "active" | "suspended" | "archived"

OrganizationMembership
  ├── (organizationId, userId) unique
  ├── role: "owner" | "admin" | "member"
  ├── invitedBy, invitedAt, acceptedAt
  └── status is implicit: active if acceptedAt set, pending otherwise
```

**Per-tenant plane** — `prisma/tenant/schema.prisma`, one DB per org named `org_<cuid>`:

```
Brain
  ├── id, name, slug, isPersonal
  ├── access: BrainAccess[]       (per-user / per-agent membership)
  └── documents, embeddings, audit logs, …
```

Cross-plane relationships are by id only — a brain row's `BrainAccess.userId` refers to a `User.id` from `aju_control`, but there is no Prisma-level FK to enforce it. Deleting a user in the control DB does not cascade into tenant DBs; that cleanup is handled by org-delete workflows and the `brain-delete` helper.

Cascading deletes inside the control plane still apply to `Organization → memberships / invitations / domains / apiKeys / tenant`. See `src/app/api/orgs/[id]/route.ts:248-259` for the manual brain gate that blocks org deletion if any brains still exist in the tenant DB — the cross-plane nature means a naïve cascade would silently leave an orphaned database.

## Cross-org isolation

The boundary between orgs is the database connection itself. Concretely:

- Every request that touches tenant data goes through `withBrainContext(client, brainIds, fn)` or the higher-level `withTenant({ organizationId, userId }, fn)` in `src/lib/tenant-context.ts`. `withTenant` resolves a `PrismaClientTenant` for one org and only one org.
- There is **no shared Postgres** for per-org data. A SQL `UNION` across orgs would require two different connections and two different clients. That isn't wired up anywhere and has no callers.
- API keys are pinned to one org (`ApiKey.organizationId` required), so an HTTP request authenticated via bearer token is deterministically scoped to the key's org before any business logic runs.
- The browser picks an org via the `aju_active_org` cookie (see [Sessions](./sessions.md)). `POST /api/orgs/[id]/switch` validates membership, writes the cookie, and the next request will open a different tenant client.
- Inside each tenant DB, a further layer of Row-Level Security filters by `app.current_brain_ids` — a user who belongs to an org can still be restricted to the brains they've been granted access to. That is a second, finer-grained isolation and is orthogonal to the org-DB boundary.

Put together: a piece of data in one org's database is unreachable from a request scoped to another org, not because a predicate filters it out but because the request's Postgres connection is pointed at a different database entirely.

## Roles and the hierarchy

`src/lib/tenant-types.ts:8`:

```ts
export type OrgRole = "owner" | "admin" | "member";
```

Permission predicates are the single source of truth and are called from every route that touches org state:

| Predicate | Allowed roles | What it gates |
|---|---|---|
| `canManageOrg(role)` | `owner` | rename org, delete org, change plan/billing |
| `canManageMembers(role)` | `owner`, `admin` | invite, remove, change role, toggle `autoAcceptDomainRequests` |
| `canInvite(role)` | `owner`, `admin` | send invitations, approve access requests |

There are no custom roles, no permission flags, no ACLs. The three-role model is deliberate — beyond a certain point roles become policies and policies need an editor, a log, and a test matrix, and we don't have that budget yet.

### Last-owner protection

`PATCH /api/orgs/[id]/members/[userId]` and `DELETE` on the same path both guard against demoting or removing the last `owner` (`src/app/api/orgs/[id]/members/[userId]/route.ts:81-87, 141-147`):

```ts
if (target.role === "owner" && newRole !== "owner") {
  const owners = await countOwners(organizationId);
  if (owners <= 1) return NextResponse.json({ error: "last_owner" }, { status: 400 });
}
```

An org must always have at least one owner. Without this guard, a single-owner team could lock itself out by demoting the lone owner to admin or by self-removing.

## Creating orgs

Two entry points, same shape:

- **Personal org** is auto-created during `/api/verify` (see [Magic links](./magic-links.md)). `isPersonal = true`, name is `"<Capitalized> Workspace"`, slug is `slugify(localPart)-<6 base36 chars>`.
- **Team org** via `POST /api/orgs` (`src/app/api/orgs/route.ts:81`). `isPersonal = false`, name is the user-supplied value, slug is derived the same way. The whole create is inside a control-DB transaction so membership + org stay consistent on failure.

Slug collisions are retried up to 3 times with a fresh random suffix (`src/app/api/orgs/route.ts:97-128`). Three was picked because, with 6 base36 chars per attempt and a live org count in the low thousands, the probability of three consecutive collisions is negligible — if we see `lastErr` fall out of the loop we surface it as a 500, which is the correct response to "your database is in a state that's worth a page".

### Tenant-DB provisioning

After the control-DB tx commits, both paths call `provisionTenant(orgId)` (`src/lib/tenant-provision.ts`). Provisioning is intentionally separate and runs outside the transaction — it opens its own connections to Neon's management API and then to the newly created database:

1. Upsert a `Tenant` row with `status = "provisioning"` (idempotent so a retry resumes cleanly).
2. Create a Postgres role `org_<cuid>_app` via the Neon API.
3. Create a database `org_<cuid>` owned by that role.
4. Connect as the new role; enable `vector` + `pg_trgm`; run `prisma migrate deploy` against the tenant schema; apply `vector-setup.sql`, `fts-setup/*.sql`, and `rls-policies.sql`.
5. Encrypt direct + pooled DSNs with `TENANT_DSN_ENC_KEY` (AES-GCM) and write them into the `Tenant` row.
6. Flip `status = "active"` and seed the org's default `Brain` inside the new DB.

Each step is idempotent. A failed provision leaves the tenant row pinned to `status = "provisioning"`, and the next retry resumes from whichever step hasn't run yet. The signup redirect surfaces provisioning failure via `?error=provisioning_failed` on `/app/onboarding` — the user is signed in and the org exists, but the tenant DB is not there yet. (Known gap: no banner renders for this query param today.)

### Renaming regenerates the slug

`PATCH /api/orgs/[id]` on a name change recomputes the slug with a new suffix rather than reusing the old one (`src/app/api/orgs/[id]/route.ts:161-184`). This keeps the slug meaningful but means old links break on rename — an acceptable trade during beta. A future stable-URL mode would need either a separate user-facing "slug" column or a redirect map.

### Deleting a team org

`DELETE /api/orgs/[id]?confirm=<slug>` (`src/app/api/orgs/[id]/route.ts:221`):

- owner-only
- personal orgs cannot be deleted
- `confirm` query param must exactly match the current slug (typed-name safety pattern)
- any remaining `Brain` rows in the tenant DB block the delete with 409, forcing the caller to remove or move them first

The brain gate is manual and it runs against the tenant DB via `tenantDbFor(orgId)`. Control-side FKs have `onDelete: Cascade`, but those only cover control-plane rows — dropping the `Organization` does not drop its tenant database. The gate exists to make sure no data silently orphans when the control-plane row disappears. (Out-of-band tenant-DB teardown is a separate operator workflow and out of scope here.)

## Domain claims

An `OrganizationDomain` lets a team say "anyone with `@example.com` should see this org when they sign up or land on `/app/join`". Claims are verified by "you own a mailbox here," not DNS, today.

`POST /api/orgs/[id]/domains` — `src/app/api/orgs/[id]/domains/route.ts:51`.

Preconditions:

1. Caller is **owner** of the target org (`canManageOrg`).
2. Domain is not on the **public-email blocklist** (see below).
3. Caller's own email domain **matches** the claimed domain. This is the `verificationMethod: "email_match"` proof — we already verified the mailbox via the magic link, so claiming a domain you already have a verified address at is zero-extra-proof.
4. The domain is not already verified by another org (friendly 409 before the unique constraint trips).

On success we write `{ domain, verifiedAt: now, verificationMethod: "email_match", claimedByUserId }`.

### Why "email_match" for now

We're in a closed beta with ~100 users. DNS TXT verification is a roadmap item (`verificationMethod` is already an enum with `"dns_txt"` and `"admin_override"` reserved — `src/lib/tenant-types.ts:24-27`) but not yet wired. The email-match path is the right default: it's instant, it's accurate for solo founders and small teams, and it requires no DNS access. For bigger shops we'll need DNS TXT eventually.

> TODO: verify — DNS TXT verification is listed as a method string but has no implementation route yet.

### Domain auto-match on signup

`/api/signup` calls `matchOrgByEmailDomain(email)` before sending the magic link. If the caller's domain matches a verified `OrganizationDomain`, the matched org slug gets attached to the magic link URL as `matched_org=<slug>`; `/api/verify` then redirects to `/app/join?org=<slug>` instead of `/app/onboarding` after grandfathering the user.

Post-verify, `/app/join` calls `GET /api/signup/domain-match?email=<email>` (`src/app/api/signup/domain-match/route.ts`) to hydrate the page with the org name, slug, and member count. That endpoint requires a matching session-email query param so it can't be used to probe third-party addresses.

Auto-match is informational, not automatic membership. The user still has to explicitly join. Whether that join creates a membership or an access request depends on `Organization.autoAcceptDomainRequests`.

> TODO: verify — the auto-join vs. access-request branching lives in the `/app/join` page and the `/api/orgs/[id]/access-requests` route, not covered in depth here.

## Invitations

Admins and owners can invite by email through `POST /api/orgs/[id]/invitations` (`src/app/api/orgs/[id]/invitations/route.ts:74`).

### Token shape and storage

- Token: `randomBytes(36).toString("base64url")` → 48 chars.
- Stored: **only the SHA-256 hash** of the token (`src/app/api/orgs/[id]/invitations/route.ts:17-22`). The DB never sees the plaintext; a read-only attacker can't accept invites they lift from the table.
- Email: the invitation link goes to `${NEXT_PUBLIC_APP_URL}/invitations/<token>/accept`.
- TTL: 7 days (`INVITE_LIFETIME_MS`).

### Why SHA-256 here (vs. scrypt for API keys)

Invite tokens have 288 bits of entropy — there's nothing a slow hash protects against that a fast hash doesn't, and the token is one-shot (consumed once, expires in 7 days). SHA-256 is adequate and keeps the lookup fast.

### Create-time validation

Before creating the invitation row:

- Email must pass the basic regex (`src/app/api/orgs/[id]/invitations/route.ts:106`).
- Role must be one of the three `ORG_ROLES`.
- The invitee must not already be a member (409 `already_member`).
- There must not be an existing pending, non-expired invite to the same email for the same org (409 `already_invited`). This is deliberate — we'd rather force a cancel-and-resend than pile up duplicate live tokens.

### Accept and decline

`POST /api/invitations/[token]/accept` (`src/app/api/invitations/[token]/accept/route.ts`) requires a signed-in session. Logic:

1. Hash the URL token, look up the invitation.
2. Reject if missing, already accepted, or expired.
3. Confirm the session user's email matches the invitation email (case-insensitive). 403 `email_mismatch` otherwise.
4. In a transaction: upsert `OrganizationMembership` with role from the invite; mark the invitation `acceptedAt = now`.
5. `setActiveOrganizationId(orgId)` so the next request lands the user inside the new org.

The accept page at `src/app/invitations/[token]/accept/page.tsx` does a direct `prisma.invitation.findUnique` instead of round-tripping the HTTP API — it's a server component in the same app, so the extra hop is pure overhead.

`POST /api/invitations/[token]/decline` is public (no session), deletes by token hash, and treats "already gone" as success so a repeat click doesn't error (`src/app/api/invitations/[token]/decline/route.ts`).

`GET /api/invitations/[token]` is also public; it returns the org name and role so the accept page can show a preview before login.

## Org switcher

Source: `src/components/app/OrgSwitcher.tsx`, mounted in `src/app/app/layout.tsx:37`.

- On mount, fetches `/api/orgs` — returns `{ orgs, activeOrganizationId }` in one round-trip (`src/app/api/orgs/route.ts:31-69`).
- Clicking another org POSTs to `/api/orgs/[id]/switch`, which validates membership and updates the `aju_active_org` cookie (see [Sessions](./sessions.md)).
- "Create organization" opens a modal and POSTs to `/api/orgs`. On success, navigates to the new org's settings page.

Members list and per-member role changes live in `/app/orgs/<id>/...` (not covered in depth here) and hit `/api/orgs/[id]/members/**`.

## The public-email blocklist

Source: `src/lib/public-email-blocklist.ts`.

This is a hard-coded set of free and disposable email domains. It gates two decisions:

1. **Domain → org auto-match** in `/api/signup` and `/api/signup/domain-match` — if your email is `alice@gmail.com`, we do not look up an `OrganizationDomain` for `gmail.com` and never prompt you to join someone else's org.
2. **Claiming a domain** in `POST /api/orgs/[id]/domains` — you can't claim `gmail.com` for your org even if you own `alice@gmail.com`.

The list covers:

- major free webmail: `gmail.com`, `googlemail.com`, `outlook.com`, `hotmail.com`, `live.com`, `msn.com`, `yahoo.com` (+ `ymail.com`, `yahoo.co.uk`), `icloud.com` (+ `me.com`, `mac.com`), `aol.com`
- privacy / indie: `proton.me`, `protonmail.com`, `hey.com`, `fastmail.com`, `zoho.com`, `mail.com`, `gmx.*`, `yandex.*`, `tutanota.com`
- disposable: `mailinator.com`, `tempmail.com`, `temp-mail.org`, `10minutemail.com`, `guerrillamail.com`, `throwawaymail.com`, `dispostable.com`

`getEmailDomain(email)` and `isPublicEmailDomain(email)` are the two exported helpers. The former trims, lowercases, validates a single `@`, and returns the domain or `null`; the latter returns `true` iff the domain is in the set.

### Why this exists

If `gmail.com` could match an org, whoever claimed it first would be prompted to approve or auto-join every new Gmail signup. That's absurd — a free mailbox provider is not a company. The blocklist makes domain-matching safely usable only for custom domains that actually signal organizational affiliation.

The list is **not exhaustive**. It's a curated set of the top N providers that cause real confusion, with room to add more as they come up. A domain not on the list but serving free mailboxes would pass through; that's an acceptable edge case at our current scale, and anyone affected can file an issue.

## Access requests — brief

`AccessRequest` is the "I saw you had an org matching my email, but I wasn't pre-invited" flow. Rows live in the `access_request` table with statuses `pending | approved | denied | expired | canceled` (`src/lib/tenant-types.ts:17-22`). Creation, approval, denial, and listing routes live under `/api/access-requests/**` and `/api/orgs/[id]/access-requests/**`. The flow is out of scope for this slice; it layers onto the same org/membership/invitation primitives documented here.
