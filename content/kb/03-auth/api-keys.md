---
title: API keys
description: Minting, scopes, storage format, and how CLI and MCP clients authenticate.
order: 40
---

# API keys

API keys are how anything outside the browser talks to aju — the CLI, the MCP server, agents, third-party integrations. They are issued per-user, **pinned to exactly one organization**, scoped, hashed at rest, and revocable.

A key belongs to a `(userId, organizationId)` pair. The organization is chosen at creation time and is immutable for the life of the key — to work against a different org, you mint a new key pinned there. This is the enforcement lever for the "one HTTP request, one tenant DB" invariant: authenticate → resolve the key's `organizationId` → open the corresponding tenant DB → run the request. No request ever reaches across org boundaries, because the key itself has no way to name a second one.

## The format: `aju_live_…`

Source: `src/lib/api-key.ts`.

```
aju_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w
└─ 9 ─┘└───────────────── 32 chars base64url ───────────────┘
  prefix-literal        random secret (24 bytes)
```

- **Plaintext length: 41 chars.** `PLAINTEXT_PREFIX = "aju_live_"` is 9 chars; the secret is `randomBytes(24).toString("base64url")` which is exactly 32 chars (`src/lib/api-key.ts:17`).
- **Stored prefix: 12 chars.** `plaintext.slice(0, 12)` — the literal `aju_live_` plus the first 3 chars of the secret. Distinct enough to recognize a key at a glance (e.g. in "last used" lists) without being reconstructable.
- **Stored hash: scrypt of the remainder.** Salt and derived key are stored as `<salt-hex>:<hash-hex>` in a single `String` column (`src/lib/api-key.ts:44`).

scrypt parameters (`src/lib/api-key.ts:19-23`):

| Parameter | Value |
|---|---|
| `N` | 16384 |
| `r` | 8 |
| `p` | 1 |
| Key length | 64 bytes |
| Salt length | 16 bytes |

### Why scrypt, not bcrypt/argon2 or HMAC

The secret has 192 bits of entropy from `randomBytes(24)` — offline brute-forcing is effectively impossible even against a fast hash. We still use scrypt so a future accidental leak of the `api_key` table doesn't hand an attacker a pre-computable rainbow table of prefixes → secrets, and so the decision is uniform with anything password-adjacent we might add later. scrypt was picked over argon2 because it's in Node's stdlib; no extra dependency, no native build step.

Why not plain HMAC: a constant-time lookup over a secret column still requires the DB row to be present, and we want the DB row to be useless on its own. The hash provides that.

### Why `aju_live_` as a prefix

Following Stripe's lead: a fixed, human-readable, literal prefix makes keys grep-able in logs, makes leaked keys easy to scan for in GitHub's secret scanner, and reserves namespace for variants. The verifier explicitly allows `aju_live_` and `aju_test_` (`src/lib/auth.ts:39`) — the latter is currently unused but reserved so we don't have to reshape the verifier when test-mode lands.

## Verification

`verifyApiKey(plaintext, storedHash)` — `src/lib/api-key.ts:48`.

1. Check the plaintext starts with `aju_live_` and is longer than 12 chars.
2. Split `storedHash` on the first `:`; decode salt and expected hash from hex.
3. Re-run scrypt on the plaintext's remainder with the stored salt.
4. `timingSafeEqual(candidate, expected)`.

Any malformed-input case returns `false` — no distinction between "wrong key" and "bad row" is surfaced.

## Minting — dashboard path

`POST /api/keys` — `src/app/api/keys/route.ts`.

Requires a logged-in session. Body:

```json
{
  "name": "my laptop",
  "organizationId": "cmxyz123…",
  "scopes": ["read", "write"],
  "expiresInDays": 90
}
```

Defaults and limits:

- `name`: required, up to 120 chars.
- `organizationId`: optional; if omitted the server falls through `resolveKeyOrg` — the active-org cookie wins, then `user.personalOrgId` (`src/app/api/keys/route.ts:125-158`). If supplied, the caller must be a member of that org or the request 403s (`"not a member of that organization"`). If the caller has no resolvable org context at all, the request 400s (`"no organization context to pin this key to"`). Either way, **every minted key ends up with a non-null `organizationId`** — there is no path to create an unpinned key from this route.
- `scopes`: defaults to `["read", "write"]`. Allowed values: `"read"`, `"write"`, `"admin"`. Unknown scopes are rejected with 400 rather than silently dropped — we don't want a typo today to become a silent privilege escalation when we add more granular scopes tomorrow (`src/app/api/keys/route.ts:25-42`).
- `expiresInDays`: optional positive integer up to `MAX_EXPIRES_DAYS = 365 * 10` (10 years; effectively no-expiry with a ceiling — `src/app/api/keys/route.ts:13`).

The UI surfaces this explicitly. `/app/keys` has an organization dropdown next to the name field; users create separate keys for each org they belong to. A single "master key" that can read every org does not exist and will not.

Response:

```json
{
  "key": { "id", "prefix", "name", "organizationId", "scopes", "createdAt", "expiresAt" },
  "plaintext": "aju_live_…",
  "warning": "Save this key now. It will not be shown again — if you lose it, revoke this key and create a new one."
}
```

The plaintext is returned **exactly once**. `GET /api/keys` returns `prefix`, `name`, `organizationId`, `scopes`, and timestamps (`src/app/api/keys/route.ts:69-91`) — a compromised session can list and revoke keys but can't extract a working one. The `organizationId` on listed keys lets the UI group them by workspace.

### CLI path

The CLI's `aju keys create <name> --org <slug>` command wraps the same route. The `--org` flag is required whenever the active profile spans more than one accessible org; when it's omitted, the CLI falls through to the profile's pinned org. See [CLI device-code flow](./cli-device-flow.md) for how `aju login` picks the org.

### Agent-provisioning path (`aju agent-provision`)

`apps/cli/cmd/agent_provision.go` drives a device-code flow with
`intent=agent`, and `POST /api/auth/device/approve` mints an `ApiKey`
with `agentId` + `organizationId` set and default
`scopes=["read","write"]`. The approver must be owner/admin of the
agent's org, and the agent must already exist in that org's tenant DB.
This is the recommended way to put a key on a separate machine (a
remote coding agent, a CI runner) without transporting plaintext across
networks. Full workflow: [remote agent provisioning](../04-agents/remote-agent-provisioning.md).
Protocol detail: [CLI device-code flow § agent variant](./cli-device-flow.md#agent-provisioning-variant-intentagent).

### OAuth path

The OAuth 2.1 authorization server (`/oauth/authorize`, `/oauth/token`) threads the caller's selected `organizationId` through the authorization-code exchange and writes it onto the minted `ApiKey` the same way the dashboard path does. An access token granted via OAuth is indistinguishable from a dashboard-minted key once it reaches `authenticate(req)` — both are bearer strings with the same `aju_live_` prefix, the same scrypt-hashed secret, and the same `organizationId` pin.

## Listing and revoking

- `GET /api/keys` — returns the caller's keys including revoked ones (audit history).
- `DELETE /api/keys/[id]` — soft-deletes by setting `revokedAt = now` (`src/app/api/keys/[id]/route.ts:38-43`). Idempotent: a second revoke is a no-op but still returns 204. Other users' keys surface as 404 so you can't probe for key IDs.

### Why soft-delete

Keeping the row lets us show "revoked on 2025-07-14" in the dashboard and correlate `apiKeyId` audit references from `authenticate()`'s `lastUsedAt` updates. A hard delete would orphan those references and make post-hoc investigation ("which key was this request using?") impossible.

## How requests authenticate

Source: `src/lib/auth.ts`, entry point `authenticate(req: NextRequest): AuthResult`.

```
Authorization: Bearer <token>
```

Resolution order (`src/lib/auth.ts:144-161`):

1. Extract the bearer token.
2. **DB-style prefix** (`aju_live_` or `aju_test_`): look up the `ApiKey` row by the 12-char prefix; run `verifyApiKey` against the stored hash; reject if `revokedAt != null` or `expiresAt < now`. If verified, load the `User` and return `{ identity, userId, email, role, apiKeyId, organizationId }`. `organizationId` resolves to `apiKey.organizationId ?? user.personalOrgId` — the fallback exists for the legacy device-code path (see [CLI device-code flow](./cli-device-flow.md)) and should be dead code for keys minted today.
3. **Env-var key**: compared against `API_KEY` (identity `admin`) and any `API_KEY_<SUFFIX>` (identity `<suffix>` lowercased, underscores → hyphens). Lookup runs `timingSafeEqual` over every configured key without short-circuiting, so an attacker can't learn which env var matched from response timing (`src/lib/auth.ts:70-81`).
4. Anything else → 401.

If the token looks like a DB key but doesn't verify, we explicitly **do not fall through to env-var auth** — returning 401 instead. A DB-prefixed string was clearly intended as a DB key; silently falling through would mask real errors.

### From auth to tenant DB

The `organizationId` returned by `authenticate(req)` is what picks the tenant Postgres database for the rest of the request. Route handlers wrap their per-tenant work in `withTenant({ organizationId, userId }, ({ tenant, tx, brainIds }) => …)` (`src/lib/tenant-context.ts:138`), which:

1. Resolves the tenant DSN via the `Tenant` routing table and opens a `PrismaClientTenant` bound to `org_<cuid>`.
2. Looks up the caller's `BrainAccess` rows inside that tenant DB to determine which brains they can see.
3. Opens a transaction and `SET LOCAL app.current_brain_ids = '<ids>'` so tenant-side RLS policies scope reads and writes to the caller's brains.

Org isolation is enforced at the DB boundary, not by a query predicate — a request with a key pinned to org A can never read org B's rows because it never connects to org B's database in the first place.

### `lastUsedAt` update is fire-and-forget

`src/lib/auth.ts:124-129`:

```ts
prisma.apiKey
  .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
  .catch((err) => console.warn("[auth] lastUsedAt update failed:", err));
```

No `await` — the request doesn't block on this write, and a DB hiccup here degrades audit fidelity but doesn't fail the request. On a busy key this causes slight write amplification; worth it to keep reads fast.

### `GET /api/auth/me`

`src/app/api/auth/me/route.ts` — returns the identity shape corresponding to whichever auth path succeeded. DB-backed keys return `{ identity, userId, email, role }`; env-var keys return `{ identity, role }` with role `"admin"` for `API_KEY` and `"member"` for everything else. The CLI uses this endpoint to show whoami in `aju login --status` and similar.

## How the CLI uses keys

The CLI stores plaintext keys in `~/.aju/config.json` and sends them as `Authorization: Bearer aju_live_…` on every request. Keys minted by the CLI device flow land in the same `ApiKey` table as dashboard-minted keys, with a `name` derived from the user agent (e.g. `"CLI on macOS"`, `"CLI on Linux"`; see `src/app/api/auth/device/approve/route.ts:13-22`).

### Profiles — one per org

Because a key is pinned to one org, the CLI supports **multiple named profiles** — one per (server, key, org, default-brain) tuple. Commands:

```
aju profiles list                       # all profiles (active is marked)
aju profiles show                       # active profile's server, user, org, brain
aju profiles use <name>                 # set default profile
aju profiles remove <name>
aju login --profile work                # create/refresh a named profile
aju login --profile work --set-default  # and make it the default
aju -p work <command>                   # one-off override
AJU_PROFILE=work aju <command>          # env-var override
```

The override precedence, resolved in `apps/cli/internal/config/config.go:190`, is: `$AJU_PROFILE` → `DefaultProfile` → `"default"`. The top-level `-p` / `--profile` flag sets `$AJU_PROFILE` before dispatch so any command picks it up uniformly.

Switching orgs on the CLI does not require any server-side state change — there is no CLI-side equivalent of the `aju_active_org` cookie. The user picks a profile, the CLI sends that profile's key, and the server resolves the key's `organizationId`. One human with three orgs has three profiles and three keys; that's the whole model.

### MCP clients

The MCP endpoint is `https://mcp.aju.sh/mcp` (configurable via `NEXT_PUBLIC_MCP_URL` for local dev and staging). MCP clients that support multiple server entries — Claude Desktop, Cursor, etc. — can register the **same URL** multiple times with different bearer tokens, one per org. The server routes each request by the key's `organizationId`, so a human in multiple orgs has seamless parallel access without any cross-org query surface.

The MCP server is conceptually identical to the CLI: another HTTP client presenting a bearer key. Routes called via MCP hit `authenticate(req)` and receive the same `AuthSuccess` shape — `{ identity, userId, email, role, apiKeyId, organizationId }` — whether the caller was the CLI, an MCP client, or a curl in a terminal.

## Scopes today vs. later

Today the three scopes (`read`, `write`, `admin`) are persisted and surfaced in the UI, but the vault routes don't yet branch on them — any authenticated key can read and write. The scope field exists to avoid a DB migration later when we do enforce it, and to let users create read-only keys for analytics tooling without the API yet honoring that distinction.

> TODO: verify — audit which vault routes (if any) check scopes. At time of writing, scope enforcement is a reserved feature, not an active gate.
