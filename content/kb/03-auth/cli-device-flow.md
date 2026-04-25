---
title: CLI device-code flow
description: How `aju login` exchanges a user code for an API key without handling the user's session.
order: 50
---

# CLI device-code flow

The CLI can't open a browser window with a session cookie attached, and we don't want to ask users to paste a long API key into a terminal. The device-code flow (RFC 8628-ish) closes the gap: the CLI gets a short user code, the user types it into a browser window that's already logged in, and the CLI polls until the server hands it a freshly-minted API key.

## Three endpoints

| Endpoint | Caller | Auth |
|---|---|---|
| `POST /api/auth/device/start` | CLI | none |
| `POST /api/auth/device/approve` | browser | session cookie |
| `POST /api/auth/device/poll` | CLI | none |

The CLI never needs a session. The browser never sees the device code. The plaintext API key is handed over exactly once and immediately scrubbed.

## Flow

```
 CLI                             aju.sh                         browser (signed in)
  │                                │                                    │
  │ POST /api/auth/device/start    │                                    │
  │──────────────────────────────▶ │                                    │
  │                                │  insert DeviceCode (pending)       │
  │ 200 { device_code, user_code,  │                                    │
  │       verification_url,        │                                    │
  │       expires_in: 600,         │                                    │
  │       interval: 2 }            │                                    │
  │ ◀──────────────────────────────│                                    │
  │                                │                                    │
  │ show user_code; open           │                                    │
  │ verification_url in browser    │                                    │
  │                                │ ◀─── GET /cli-auth?code=XXXX-YYYY ─│
  │                                │                                    │
  │                                │  page confirms code and asks       │
  │                                │  "authorize as <email>?"           │
  │                                │                                    │
  │                                │ ◀─ POST /api/auth/device/approve ──│
  │                                │     { user_code, deny? }           │
  │                                │                                    │
  │                                │  mint ApiKey (hashed)              │
  │                                │  DeviceCode.status = approved      │
  │                                │  DeviceCode.apiKeyPlaintext = …    │
  │                                │                                    │
  │ POST /api/auth/device/poll     │                                    │
  │──────────────────────────────▶ │                                    │
  │ 200 { status: "approved",      │  DeviceCode.status = used          │
  │       api_key: aju_live_… }    │  DeviceCode.apiKeyPlaintext = null │
  │ ◀──────────────────────────────│                                    │
```

## `POST /api/auth/device/start`

Source: `src/app/api/auth/device/start/route.ts`.

- Generates a **user code** in the form `XXXX-YYYY` (two groups of 4) from a 32-char alphabet that excludes `0OILS1` to stop the eye-confusables nightmare: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (`src/app/api/auth/device/start/route.ts:12`).
- Generates a **device code** as 32 random bytes base64url. This one never leaves the CLI and the server.
- Writes `DeviceCode { userCode, deviceCode, status: "pending", expiresAt: now + 10min }` with a 10-minute TTL (`DEVICE_CODE_TTL_SEC = 600`).
- Returns `{ device_code, user_code, verification_url, expires_in, interval }`. `verification_url` is `${NEXT_PUBLIC_APP_URL}/cli-auth?code=<user_code>`.

User-code collision is guarded by a retry loop up to 5 times (`src/app/api/auth/device/start/route.ts:26`). The space is `32^8 ≈ 10^12`, so a collision against the small number of pending codes at any moment is astronomically unlikely — the retry is a seatbelt, not a load-bearing feature.

### Why a 10-minute TTL

Long enough that someone can open the browser, sign in with a magic link (if they weren't already), and click Authorize. Short enough that an unattended laptop's screen-shoulder-surf window is bounded.

### Why the short `interval`

2 seconds — CLI polls every 2s by convention. This is hint only; the server doesn't enforce a rate limit on `poll` today.

> TODO: verify — no explicit rate limit is present in `poll/route.ts`. Relies on the device code being invalidated on first successful poll.

## The browser side: `/cli-auth?code=…`

Source: `src/app/cli-auth/page.tsx`.

The page is a server component that:

1. Normalizes the URL code by trimming + uppercasing (`src/app/cli-auth/page.tsx:10-15`) so that case differences between what the terminal prints and what the user types in don't matter.
2. Calls `currentUser()`. If null, renders a "sign in first" panel whose CTA returns to `/?return_to=/cli-auth?code=<userCode>` — the magic-link flow preserves the deep link so the user lands back here with a session after signing in.
3. Fetches the `DeviceCode` row by `userCode`. Renders one of:
   - **unknown code** — no row.
   - **expired** — `expiresAt < now` or `status === "used"`.
   - **already authorized** — `status === "approved"` (this page was reloaded after an earlier approval; the panel tells the user the terminal has already finished).
   - **denied** — `status === "denied"`.
   - **pending** — the live prompt, showing the code and approve/deny buttons.

The approve/deny buttons live in the client component `src/components/cli-auth/ApproveControls.tsx`, which POSTs to `/api/auth/device/approve` with `{ user_code, deny }`.

### Why show the code on the page

The whole security story rests on the user confirming that the code on the page matches the code in the terminal. Without that, the flow devolves into "click this link on any device to grant it your session," which is phishing in a nicer suit. Showing the code makes the confirmation explicit.

## `POST /api/auth/device/approve`

Source: `src/app/api/auth/device/approve/route.ts`.

Requires a session. Body: `{ user_code, deny? }`.

1. Look up the `DeviceCode` by `userCode`.
2. Reject if expired, already approved, already denied, or already used.
3. If `deny === true`: set status to `"denied"`, return `{ ok: true }`. The CLI poll will soon return `{ status: "denied" }` and delete the row.
4. Otherwise **mint a fresh `ApiKey`** for the signed-in user via `generateApiKey()` and write:
   - prefix + scrypt hash into `ApiKey`
   - `apiKeyPlaintext`, `apiKeyId`, `approvedByUserId`, `status = "approved"` into the `DeviceCode` row

Key naming uses a small UA heuristic (`src/app/api/auth/device/approve/route.ts:13-22`) so the key shows up as `"CLI on macOS"`, `"CLI on Windows"`, `"CLI on Linux"`, or plain `"CLI"` in the dashboard.

### Known gap: device-flow keys are not org-pinned

`POST /api/auth/device/approve` currently mints an `ApiKey` **without setting `organizationId`**. Every other mint path — dashboard (`POST /api/keys`), OAuth (`/oauth/token`) — writes the caller's selected org onto the key, which is how tenant-DB routing stays deterministic. The device-flow path skips this today.

The fallout is handled (but not cleanly) at auth time: when `authenticate(req)` loads the `ApiKey` row, it resolves `organizationId` as `apiKey.organizationId ?? user.personalOrgId` (`src/lib/auth.ts:144-161`). An unpinned device-flow key therefore silently binds to the user's personal org. If the CLI user's intent was to work against a team org, they'll find themselves in the wrong workspace without a visible reason. The workaround today: mint a team-pinned key from the dashboard or `aju keys create <name> --org <slug>` and put it in a named profile (see the "Profiles — one per org" section of [API keys](./api-keys.md)).

The fix is to thread the `organizationId` choice through `/cli-auth` and `/api/auth/device/approve` the same way `/oauth/authorize` does. Tracked; not in scope for this slice of docs.

### Why the plaintext sits on `DeviceCode` at all

Two requests, two HTTP calls, two different clients — they need a shared channel to hand a secret between. The `DeviceCode` row is that channel. `apiKeyPlaintext` is nullable, narrow in scope (only set while the device code is `"approved"`, immediately cleared on poll), and never indexed.

A more paranoid design would encrypt the plaintext at rest with a per-row key derived from the `deviceCode` itself so that a DB-only attacker still has to guess the device code to recover the plaintext. We chose the simpler design because the window between approve and poll is 2 seconds to 10 minutes, after which the row is deleted, and the plaintext is scrubbed on the poll that hands it over.

> TODO: verify — consider threat model of DB snapshot taken during the approve/poll window.

## `POST /api/auth/device/poll`

Source: `src/app/api/auth/device/poll/route.ts`.

Body: `{ device_code }`.

Response matrix:

| `DeviceCode.status` | expired? | response |
|---|---|---|
| `pending` | no | `{ status: "pending" }` |
| any | yes | delete row, `{ status: "expired" }` |
| `used` | — | delete row, `{ status: "expired" }` |
| `denied` | no | delete row, `{ status: "denied" }` |
| `approved` | no, has plaintext | update `{ status: "used", apiKeyPlaintext: null }`, return `{ status: "approved", api_key: plaintext }` |
| `approved` | no, no plaintext | delete row, `{ status: "expired" }` (defensive) |
| anything else | — | `{ status: "expired" }` |

The plaintext is handed over **exactly once**. On the successful poll we transition `pending → approved → used` and null out the plaintext column in the same `UPDATE`, so even a second successful approve somehow can't double-issue from the same device code.

### Why delete rows on terminal states

Terminal states (expired/denied/used) have no future value. Deleting the row:
- frees the user-code namespace immediately,
- means the "unknown code" path on `/cli-auth` serves as a natural "too late" panel,
- stops unbounded growth in the `device_code` table for an endpoint that runs thousands of times a day on a busy deployment.

### Why the CLI has to poll

We considered a webhook or WebSocket from the browser to the CLI, but the CLI may be running behind a NAT with no reachable port, possibly across networks, possibly on a different machine than the browser. Polling is the lowest-common-denominator channel that works everywhere without extra setup. The 2-second interval keeps latency tolerable without hammering the server.

## Agent-provisioning variant (`intent=agent`)

The same three endpoints also mint **agent-scoped** keys when the CLI sends
`intent=agent` at start. This is how a remote machine — `openclaw`, `aider`,
a CI runner — gets credentials to act as a pre-existing aju agent without
anyone copying a plaintext key across networks.

### What changes on the wire

- `POST /api/auth/device/start` accepts
  `{ intent: "agent", agent_name: "<name>" }` in the body. If `intent` is
  absent or `"user"` the flow is unchanged. `agent_name` is required when
  `intent=agent` and is stored on the `DeviceCode` row alongside the new
  `intent` field.
- `POST /api/auth/device/approve` branches on `row.intent`:
  - For `"user"`: behaves as before — mints a personal `ApiKey` for the
    approver and attaches the plaintext.
  - For `"agent"`: resolves the approver's active org, verifies owner/admin
    membership, looks up an `Agent` in that tenant DB by name, then mints
    an `ApiKey` with `agentId` + `organizationId` set and
    `scopes = ["read","write"]`.
- `POST /api/auth/device/poll` is unchanged — the CLI just gets back
  `{ status: "approved", api_key }` either way.

### New `DeviceCode` columns

| Column | Purpose |
|---|---|
| `intent` (default `"user"`) | Which approve-branch to take. |
| `agentName` | The hint passed at start; resolved to an agent at approve time. |
| `agentId` | Filled in on approve success; the agent the key was minted for. |

Keeping `intent` nullable-by-default preserves backwards compatibility for
pre-existing rows and for `aju login` clients that don't send a body.

### Approve-side failure modes

The `/cli-auth` page renders one of these before exposing the Approve
button, and `/api/auth/device/approve` enforces all of them server-side as
a final gate:

| Failure | Trigger | UX |
|---|---|---|
| `agent_name` missing on the row | malformed CLI start | "missing agent name" panel, restart-with-correct-command hint |
| no active org | approver not in an org | "no active org" panel |
| approver not owner/admin | `canManageMembers(role)` false | "insufficient permissions" panel |
| agent not found | no `Agent` with that name in tenant DB | "agent not found" panel, with `aju agents create <name>` hint |
| agent revoked | `agent.status === "revoked"` | "agent revoked" panel |

The approver only sees the approve button when all five checks pass, and
sees the agent's current `BrainAccess` grants inline so they can verify the
scope before approving.

### Why the agent must pre-exist

We deliberately do *not* create the agent as a side-effect of approval. The
approve page's trust story is "mint a key for this named principal with
these existing grants" — if approving also created the agent (and
implicitly its grants, or worse, granted nothing and left it inert), the
reviewer wouldn't be able to confirm blast radius just by reading the
page. Keeping creation separate (`aju agents create <name>` +
`aju agents grant <id> <brain>`) preserves the invariant that the approval
page never introduces new capability — it only binds a key to capability
that was already configured.

### CLI: `aju agent-provision <name>`

`apps/cli/cmd/agent_provision.go` is a near-copy of the `Login` loop with
two differences:

1. The start body includes `intent: "agent"` and `agent_name: <name>`.
2. If `--profile` is omitted, the profile name defaults to the agent name.
   This makes the common case of one-agent-per-remote-box a single
   command: `aju agent-provision openclaw` writes to a profile called
   `openclaw`.

The browser opens to `/cli-auth?code=<user_code>` exactly as with user
login; approver sees the agent-intent panel described above. On
`{ status: "approved", api_key }` the CLI writes the key to the profile's
`Key` slot and (if `--set-default` or no default exists) updates
`defaultProfile`.

### Revocation and rotation

Agent keys live in the same `ApiKey` table as user keys. The shape:

```
{ userId: approver.id, agentId: agent.id, organizationId: org.id, scopes: ["read","write"] }
```

So `userId` is the human who clicked Approve (for audit + admin revoke
UX), and `agentId` is the principal the key authenticates as. Revoking
follows the normal path — `aju keys revoke <prefix>` or the dashboard —
and flipping `agent.status` to `"revoked"` disables every key belonging to
that agent at once.

## Denial and expiration UX

- **Deny** from the browser: the next CLI poll returns `{ status: "denied" }`. The CLI prints an error and exits nonzero.
- **Expiration**: the CLI is supposed to stop polling at `expires_in` seconds. If it doesn't, any poll after that point returns `{ status: "expired" }` and the row is cleaned up.
- **Browser reload after approve**: the page shows "already authorized" rather than a blank state, because `status === "approved"` is kept until the CLI polls. Once polled, `status = "used"` and a subsequent reload shows "expired" (the terminal state's UX label).
