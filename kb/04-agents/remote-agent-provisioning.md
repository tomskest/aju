---
title: Remote agent provisioning
description: How to give a separate machine — OpenClaw, Aider, a CI runner — an agent-scoped key without copying secrets across networks.
order: 45
---

# Remote agent provisioning

Running an autonomous coding agent (OpenClaw, Aider, Codex, …) on a
separate machine is the recommended deployment pattern — if the agent
misbehaves, blast radius is bounded by that machine's filesystem and
network. The unsolved piece has been credentials: how do you get an aju
key onto a remote box without pasting plaintext through SSH, a chat
channel, or your shell history?

`aju agent-provision` closes that gap. It reuses the [CLI device-code
flow](../03-auth/cli-device-flow.md) with `intent=agent`, so the key is
generated server-side, delivered over TLS to the remote box that started
the flow, and never crosses an unencrypted hop.

## The workflow

```
┌── your laptop ──────────────────┐       ┌── remote box (OpenClaw) ──┐
│                                 │       │                           │
│  aju agents create openclaw     │       │                           │
│  aju brains create openclaw-sb  │       │                           │
│  aju agents grant <id> …        │       │                           │
│                                 │       │  aju agent-provision \    │
│                                 │       │      openclaw             │
│  (browser opens — or paste URL) │◀──────│  (prints URL + user code) │
│                                 │       │                           │
│  approve page shows:            │       │  (polls)                  │
│    • agent name                 │       │                           │
│    • current brain grants       │       │                           │
│    • [Authorize] [Deny]         │       │                           │
│                                 │       │                           │
│  click Authorize ──────────────▶│──────▶│  receives api_key,        │
│                                 │       │  writes profile           │
└─────────────────────────────────┘       └───────────────────────────┘
```

Steps in prose:

1. **On your laptop**, create the agent and set its scope. This is the
   "what can this principal ever do" step, done once:

   ```bash
   aju agents create openclaw --description "coding agent on vps-1"
   aju brains create openclaw-sandbox --type agent
   aju agents grant <agent-id> openclaw-sandbox --role editor
   aju agents show <agent-id>    # sanity-check the grants
   ```

2. **On the remote machine**, run the provisioning command. This kicks
   off a device-code flow, prints a URL + short user code, and polls:

   ```bash
   aju agent-provision openclaw
   ```

   It defaults the local profile name to the agent name, so the key
   lands in a profile called `openclaw` without any flag plumbing. Pass
   `--profile <name>` to override, or `--set-default` to also make it
   the default profile for future invocations.

3. **Back on your laptop**, open the URL. The
   [`/cli-auth` page](../03-auth/cli-device-flow.md#the-browser-side-cli-authcode-)
   detects `intent=agent` and renders an agent-provisioning panel instead
   of the regular login confirmation. You see:

   - the agent name the remote box sent
   - every brain the agent currently has access to, with the role
   - Authorize / Deny buttons

   If anything is wrong (agent not found, revoked, grants missing, you're
   not an org admin), the panel says so instead of showing Authorize.
   Approve is the only positive action; everything else short-circuits.

4. **Click Authorize.** The server mints an
   [agent-scoped API key](../03-auth/api-keys.md), attaches the plaintext
   to the device-code row, the remote box's next poll picks it up, and
   the CLI writes it to the named profile. From now on every `aju …`
   command on the remote machine authenticates as the OpenClaw agent.

## What ships to the remote box

Only the binary and the minted key. Concretely:

```
~/.config/aju/config.json
{
  "defaultProfile": "openclaw",
  "profiles": {
    "openclaw": {
      "server": "https://aju.sh",
      "api_key": "aju_live_…"
    }
  }
}
```

No `.env` with secrets. No hand-transcribed token. If the config file is
read-restricted (`chmod 600`, which the CLI writes by default) the key is
as safe as anything else scoped to that Unix user.

## The safety story, end-to-end

The guarantee the system gives you for an approved agent:

- **BrainAccess is the only authz signal.** The agent sees and writes
  exactly the brains it has `BrainAccess` rows for, and nothing else.
  Every `/api/vault/*` route filters by `brainId = ANY(<accessible>)` at
  the SQL layer — not a policy check, the query literally doesn't return
  other brains' data. See [tenant isolation](../02-data/tenant-isolation.md).
- **Agents start with zero access.** `aju agents create` produces a
  principal that can authenticate but can't read or write anything until
  you explicitly grant brains.
- **Agents cannot escalate themselves.** The endpoints that would let an
  agent grant itself more access (`POST /api/agents/:id/keys`,
  `POST /api/agents/:id/brains`) require `currentUser()` (a session-
  authenticated human) *plus* owner/admin role. An agent-scoped key hits
  those with 401.
- **Approval happens in a trusted browser session.** The device-code flow
  forces the decision to be made in a tab that already has your aju
  session cookie. A compromised remote box can request provisioning but
  cannot consummate it without you.
- **Instant kill switch.** `aju keys revoke <prefix>` cuts the specific
  provisioning. `aju agents revoke <id>` disables every key the agent
  holds. Both are DB-level and take effect on the agent's next request.

## Monitoring what the agent does

Two complementary surfaces:

1. **`aju agents activity <id>`** — hits
   [`GET /api/agents/:id/activity`](../02-data/documents-and-versioning.md),
   which filters `vault_change_log` to rows whose `actorType=agent,
   actorId=<agent-id>`. Gives you every write the agent has performed,
   with path, timestamp, and operation. Poll from your laptop on a loop
   or build a dashboard tab.

2. **`aju changes --brain openclaw-sandbox --since <ts>`** — changelog
   for the sandbox brain regardless of actor. If you see writes from any
   source other than the agent, something's configured wrong.

Read activity is intentionally not logged for now; see
[documents and versioning](../02-data/documents-and-versioning.md#readandview-events)
for the design rationale.

## Why the agent must exist before provisioning

The approve page never grants capability — it only *binds a key to
existing capability*. Creating an agent as a side-effect of approval
would break that invariant, because the reviewer wouldn't be able to
confirm blast radius by reading the page. It also conflates two decisions
("what can this agent do" vs. "does this machine get to act as the
agent") that have different blast radii and different lifecycles. The
separation pays off the moment you want to mint a second provisioning
for the same agent (swap hardware, add a second runner) — you just rerun
`agent-provision`; the grants don't move.

Practically this means the first time you run `aju agent-provision foo`
for a fresh agent name, you'll see "agent not found" in the browser. Go
create it, grant its brains, then rerun on the remote. The user-code
from the remote's started flow stays valid for 10 minutes.

## Known gaps / follow-ups

- **No scope or expiry controls at the approve page.** Keys are minted
  with `scopes=["read","write"]` and no expiry. If you need a read-only
  agent key or a time-boxed one, mint it via
  [`POST /api/agents/:id/keys`](../03-auth/api-keys.md#minting--dashboard-path)
  instead of the device-code flow.
- **Provisioning from the approve page is admin-only.** By design — see
  "Approve-side failure modes" in [CLI device-code flow](../03-auth/cli-device-flow.md#agent-provisioning-variant-intentagent).
  If you want non-admin team members to provision agents onto their own
  dev machines, the right move is probably a self-service invite link per
  agent rather than loosening the device-flow check; not built yet.
- **Multiple concurrent provisionings for one agent.** Supported — each
  produces a separate `ApiKey` row with the same `agentId`. The operator
  sees them all in `aju agents keys list <id>` and can revoke any one
  without affecting the others. Useful for "the laptop I was on last
  week still has a key; I don't want to revoke it yet, but this new
  runner needs its own."
