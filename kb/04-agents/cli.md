---
title: The aju CLI
description: The Go CLI in client/cli — architecture, command dispatch, device login, and how commands talk to the hosted API.
order: 40
---

# The aju CLI

The CLI is a single static Go binary. Source lives in `client/cli/`.

```
client/cli/
  main.go            — top-level dispatch
  cmd/               — one file per command group
    auth.go          — login / logout / status / whoami
    brains.go        — brains list/create/delete/switch
    search.go        — search / semantic
    notes.go         — read / browse / create / update / delete
    graph.go         — backlinks / related / graph / rebuild-links / changes
    files.go         — files list/read/upload/delete
    export.go        — export
    skill.go         — skill install / remove (targets `claude`, more later)
    skill_body.md    — the embedded SKILL.md template
    stub.go          — placeholders (incl. `aju mcp serve`)
    profiles.go      — profiles list/use/show/remove (multi-org routing)
    keys.go, orgs.go, agents.go, news.go, doctor.go, update.go, precheck.go
  internal/
    config/          — ~/.aju/config.json
    httpx/           — net/http wrapper with typed errors
    browser/         — opens URLs for device login
    manifest/        — self-update manifest handling
    state/           — local state (news-seen, etc.)
```

## Dispatch

`main.go:23-124` is a flat `switch` over `os.Args[1]`. No Cobra, no Urfave,
no command tree — just string matches dispatching to functions in the `cmd`
package. Four subcommand dispatchers (`skill`, `brains`, `files`, `mcp`)
do a second-level switch, and a parallel two-deep group lives in
`profiles.go`.

Before the switch runs, `extractProfileFlag` (`main.go:236-259`) peels off
any leading `-p <name>` / `--profile <name>` / `--profile=<name>` and
exports it as `AJU_PROFILE`. That way every subcommand's `config.Load()`
call picks the right (user, org) pair without each command needing to
know the flag exists. Only leading flags are considered — `aju search "-p"`
still passes `-p` through to the search command.

`main.go:38-106`:

```go
switch first {
case "login":      exitWith(cmd.Login(rest))
case "status":     exitWith(cmd.Status(rest))
case "skill":      exitWith(dispatchSkill(rest))
case "brains":     exitWith(dispatchBrains(rest))
case "search":     exitWith(cmd.Search(rest))
case "semantic":   exitWith(cmd.Semantic(rest))
case "read":       exitWith(cmd.Read(rest))
case "browse":     exitWith(cmd.Browse(rest))
case "create":     exitWith(cmd.Create(rest))
case "self-update": exitWith(cmd.UpdateSelf(rest))
case "update":
  // Bare `aju update` (no path) is a deprecated alias for `self-update`.
  // It still dispatches there with a stderr warning.
  if isSelfUpdateInvocation(rest) { exitWith(cmd.UpdateSelf(rest)) }
  else                            { exitWith(cmd.UpdateNote(rest)) }
case "delete":     exitWith(cmd.Delete(rest))
case "backlinks":  exitWith(cmd.Backlinks(rest))
// …
```

### Why a flat switch

The CLI is ~25 top-level commands and three two-deep dispatchers. A CLI
framework would buy us flag parsing sugar and auto-generated help. Every
command already parses its own `flag.FlagSet` (a stdlib type), and the help
text is hand-written at `client/cli/cmd/help.go`. The trade is: zero external
deps in `main`, no implicit behavior, `go build` produces a single binary
that starts in a few milliseconds. Worth it for a utility people type into
a terminal dozens of times a day.

### The `update` dual-dispatch (legacy, deprecated)

The canonical commands are `aju self-update` for the CLI binary and
`aju update <path>` for notes — two unrelated operations with non-overlapping
shapes.

For the deprecation window, bare `aju update` (no positional path) still
dispatches to `cmd.UpdateSelf` and prints a stderr warning telling the
caller to use `aju self-update`. The `isSelfUpdateInvocation` helper
scans for a non-flag positional to drive the dispatch. Once the warning
window closes, the `case "update"` branch should require a positional
path and the helper can be deleted.

## Config — profiles

Single file: `~/.aju/config.json`, mode `0600`. Since the backend split to
one Postgres database per organization, one machine often needs to hold
credentials for **several** orgs at once. The config file is therefore a
map of named profiles, one per (user, org) pair:

`client/cli/internal/config/config.go`:

```go
// Shape (v1):
//
//   {
//     "defaultProfile": "work",
//     "profiles": {
//       "personal": { "server": "...", "key": "aju_live_...", "org": "toomas-lxh5a7" },
//       "work":     { "key": "aju_live_...", "org": "acme-corp" }
//     }
//   }

type Profile struct {
    Server string `json:"server,omitempty"`  // default https://aju.sh
    Key    string `json:"key,omitempty"`     // aju_live_* API key (pinned to Org)
    Brain  string `json:"brain,omitempty"`   // active brain within the Org
    Org    string `json:"org,omitempty"`     // org slug the Key is pinned to
}

type Config struct {
    DefaultProfile string              `json:"defaultProfile,omitempty"`
    Profiles       map[string]*Profile `json:"profiles,omitempty"`
    Active         string              `json:"-"`   // resolved per-invocation
}
```

### Active profile resolution

`resolveActive` (`config.go:195-211`) picks which profile this invocation
uses, in order:

1. `$AJU_PROFILE` — env override, also set by the top-level `-p` flag.
2. `Config.DefaultProfile` — persisted, written by `aju profiles use <name>`.
3. `"default"` if a profile by that name exists.
4. The sole profile, if exactly one is configured.
5. `"default"` as a last resort (empty accessors).

### v0 migration

Pre-split configs had flat top-level `server`/`key`/`brain`/`org` fields
and no profiles map. On load, those are folded into a profile called
`"default"` (`config.go:142-157`) and rewritten on next `Save` in v1
shape. No user action required.

### Accessors and all that

`loadAuthedClient()` (`client/cli/cmd/client.go:24-34`) returns a friendly
`Not signed in — run 'aju login'` when the **active profile's** Key is
empty. Every subcommand calls through it — so the profile selection is
transparent to command handlers: they see a single `cfg.Profile()` and
don't know which profile name it came from.

## Profiles subcommand

`client/cli/cmd/profiles.go`:

```
aju profiles list            # every configured profile, active one starred
aju profiles show            # detail for the active profile
aju profiles use <name>      # persist <name> as the default profile
aju profiles remove <name>   # delete a profile (must not be active; --yes to skip confirm)
```

`list` output is tab-separated: `marker name org server signed-in-state`.
The active profile is marked with `*`; a profile without an API key reads
`not signed in`.

`remove` refuses to delete the currently-active profile — switch first.
It also does **not** revoke the API key on the server; run
`aju keys revoke <prefix>` for that.

## Multi-org workflow

Three ways to use multiple orgs from one terminal:

**1. Persistent default switch:**

```
aju profiles use work
aju search "hamburg cluster"       # routes to work's tenant DB
aju profiles use personal
aju search "journal entries"       # routes to personal's tenant DB
```

**2. Per-invocation override (doesn't change the default):**

```
aju -p work search "hamburg"              # top-level -p flag
aju --profile work search "hamburg"
AJU_PROFILE=work aju search "hamburg"     # env-var form
```

The top-level `-p <name>` / `--profile <name>` is peeled off by
`main.go:extractProfileFlag` before command dispatch, exported as
`AJU_PROFILE`, and picked up by `config.Load()` downstream.

**3. New org → new profile via login:**

```
aju login --profile work           # starts device flow, mints a key pinned to work's org
aju login --profile work --set-default  # also flip the persistent default
```

The `--profile` flag on `aju login` (`auth.go:63`) names which profile
slot the minted key and org details land in. Because each `aju_live_*` key
is pinned to exactly one organization server-side, adding a new profile
is how you add a new org to your CLI.

## HTTP transport

`client/cli/internal/httpx/client.go` is a thin wrapper over `net/http` that:

- Sets `Authorization: Bearer <active profile's Key>` and
  `x-aju-cli-version: <Version>` headers (`httpx/client.go:106-114`).
- Categorizes errors into `ErrNetwork | ErrHTTP | ErrDecode`
  (`httpx/client.go:27-35`) so callers can branch cleanly.
- Offers `Get / Post / GetJSON / PostJSON / RawGet` — the last one returns
  the raw `*http.Response` for streaming (used by `aju export` to pipe
  the JSON body straight to disk).

Timeout is a hard `30s` for everything except `RawGet` streams.

The server reads the bearer token, looks up `ApiKey.organizationId`, and
picks the tenant DB via `tenantDbFor(orgId)` — the CLI does not need to
send an `org` hint. Profile switching is purely a matter of which key the
CLI attaches to the request.

The `x-aju-cli-version` header is what `client/cli/cmd/precheck.go` uses to
warn users when their binary is below the server's `min_supported`
version. The hosted app publishes a version manifest at
`/api/cli/manifest` (or similar — see `internal/manifest/`), the CLI
fetches it lazily once per invocation, and if the running version is below
`min_supported` the command hard-stops before dispatching anything.

## Authentication: device code flow

`client/cli/cmd/auth.go:60-165` implements `aju login`:

1. `POST /api/auth/device/start` → `{ device_code, user_code, verification_url, expires_in, interval }`.
2. Print the URL + user code, open the browser via
   `internal/browser/browser.Open()`.
3. Poll `POST /api/auth/device/poll` every `interval` seconds (default 2s)
   with the `device_code`.
4. When the server returns `{ status: "approved", api_key: "aju_live_…" }`,
   save the key into the **active profile** in `~/.aju/config.json`.

`denied` and `expired` both exit 1 with a friendly message. Transient
network errors during polling are logged to stderr but don't break the
loop — the next tick retries.

### Naming a profile at login

```
aju login                                     # writes to the currently-active profile
aju login --profile work                      # writes to the "work" profile (created if absent)
aju login --profile work --set-default        # same, and also persist "work" as the default
```

`--profile work` calls `cfg.SetActive("work")` before starting the flow
(`auth.go:73-75`), so the minted key lands in that profile's slot. If no
default profile is yet set, the newly-populated one becomes default
automatically (`auth.go:133-135`); `--set-default` forces the switch on
top of an existing default.

### Which org does a minted key route to?

The hosted `/api/auth/device/start` flow requires the user to pick a
target org during the browser approval step. The approved key's
`ApiKey.organizationId` is set server-side; the CLI never has to specify
the org on its own. Subsequent requests with that key always route to
that org's tenant DB — to use another org from the same user account,
run `aju login --profile <other-name>` again.

For non-interactive key minting (e.g. CI), `aju keys create <name> --org <slug>`
(`keys.go:129`) forces a specific org; the slug or cuid must match one of
the user's memberships. With a single-org user the `--org` flag is
optional and defaults to the active org.

### Why device code, not "paste your API key"

Copying a long bearer token through a terminal is error-prone and exposes
the token to shell history. Device code flow keeps the secret on the
server side until approval, then the CLI receives it once via HTTPS. It's
also the same flow `gh auth login` uses, so it meets operator muscle
memory.

### `aju agent-provision <name>` — same flow, agent-scoped key

`client/cli/cmd/agent_provision.go` is a near-copy of `Login` that sends
`intent=agent` + `agent_name` to `/api/auth/device/start`. The approve
page branches to an agent-provisioning panel, admin-gates the action, and
mints an `ApiKey` with `agentId` + `organizationId` populated so the key
authenticates as the agent rather than the approver. The CLI defaults the
profile name to the agent name when `--profile` is omitted, so the
typical one-agent-per-remote-box case is a single command:

```
aju agent-provision openclaw
```

Used for the recommended pattern of running coding agents on an isolated
machine. Full workflow is in [remote agent provisioning](./remote-agent-provisioning.md);
the protocol-level detail is in [CLI device-code flow § agent variant](../03-auth/cli-device-flow.md#agent-provisioning-variant-intentagent).

### `aju logout` and the server

Logout just clears the active profile's Key in the local config file — it
does NOT revoke the key server-side. To revoke a key you use
`aju keys revoke <id-or-prefix>`. That's deliberate: users share tokens
across machines, so `logout` forgetting the local key but leaving the
server-side credential alive is the expected semantics. To log out of a
specific profile, combine with `-p`:

```
aju -p work logout
```

## Reading and writing documents

Every note command maps to a single REST endpoint:

| Command | Endpoint | Verb |
|---|---|---|
| `aju search` | `/api/vault/search?q=…` | GET |
| `aju semantic` | `/api/vault/semantic-search?q=…&mode=…` | GET |
| `aju deep-search` | `/api/vault/deep-search?q=…&seeds=…&depth=…` | GET |
| `aju read <path>` | `/api/vault/document?path=…` | GET |
| `aju browse <dir>` | `/api/vault/browse?directory=…` | GET |
| `aju create <path>` | `/api/vault/create` (body `{path, content, source: "cli"}`) | POST |
| `aju update <path>` | `/api/vault/update` | POST |
| `aju delete <path>` | `/api/vault/delete` | POST |
| `aju backlinks <path>` | `/api/vault/backlinks?path=…` | GET |
| `aju related <path>` | `/api/vault/related?path=…` | GET |
| `aju graph` | `/api/vault/graph?mode=…` | GET |
| `aju changes` | `/api/vault/changes?since=…` | GET |
| `aju files list` | `/api/vault/files/list` | GET |
| `aju files upload` | `/api/vault/files/upload` | POST (multipart) |
| `aju export` | `/api/me/export` | GET (raw stream) |

Every request sends `?brain=<name>` when the user has set one via
`aju brains switch <name>` (stored in the active profile's `Brain` field)
or passed `--brain <name>` on the command line
(`client/cli/cmd/client.go:39-47`). Brain names are scoped to the tenant
DB of the active profile's org — a `brains list` on one profile won't
show brains that live in another profile's org.

## Output conventions

Default output is tab-separated, grep/awk-friendly. `--json` on most
commands emits the raw API response verbatim. From
`client/cli/cmd/search.go:117-136`:

```go
func printSearchResults(results []searchResult) {
    for _, r := range results {
        score := r.RRFScore
        if score == 0 { score = r.Similarity }
        if score == 0 { score = r.Rank }
        fmt.Printf("%s\t%.4f\t%s\n", r.Path, score, oneLine(r.Snippet))
    }
}
```

Errors go to stderr. `ErrSilent` (`client/cli/cmd/client.go:15`) is used
when the handler already printed a friendly message and wants `main.exitWith`
to `os.Exit(1)` without double-printing.

## `aju deep-search` — GraphRAG escalation

`aju deep-search` is the third retrieval mode alongside `search` (keyword
FTS) and `semantic` (embeddings). It runs a hybrid FTS+vector query to
pick a handful of **seed** documents, then walks the wikilink graph 1–2
hops out from those seeds and re-ranks the combined set by a blended
score (relevance × graph proximity × link-density).

Use it when the question spans multiple connected notes — "how does X
relate to Y?", "what's the whole picture around Z?" — rather than a
single document lookup.

Flags (`client/cli/cmd/search.go:113-161`):

| Flag | Default | Notes |
|---|---|---|
| `--brain <name>` | active brain | |
| `--section <prefix>` | — | Filter seeds by vault section. |
| `--type <type>` | — | Filter seeds by document type. |
| `--seeds <n>` | `5` | Seed documents to expand from (max 20). |
| `--limit <n>` | `20` | Results after re-ranking (max 100). |
| `--depth 1\|2` | `1` | Graph expansion depth. `2` = friends-of-friends. |
| `--json` | false | Raw API response. |

Human output tags each row: `S` for a seed hit, `G1`/`G2` for graph
neighbors at hop distance 1 or 2. Graph rows also print the seed(s) they
were linked from. From `client/cli/cmd/search.go:163-184`:

```go
marker := "S" // seed
if r.Source == "graph" {
    marker = fmt.Sprintf("G%d", r.Hop)
}
fmt.Printf("%s\t%.3f\t%s\t%s\n", marker, r.Score, r.Path, oneLine(title))
```

`depth=2` is deliberately the ceiling. Beyond two hops the graph walk
saturates — most of the brain is reachable, and the blended score no
longer discriminates usefully. Keep `depth=1` the default unless the
query is genuinely cross-topic.

## `aju export`

`client/cli/cmd/export.go:18-63`. Streams the response from
`GET /api/me/export` directly to `./aju-export-<YYYY-MM-DD>.json` (or the
path given via `-o`). The server returns the full portable JSON —
profile + owned brains + all markdown documents + file metadata — in one
response. File binaries are NOT inlined; `aju export` prints a reminder
that you fetch those with `aju files read <key> --mode content`.

Why a separate flow: the export endpoint can return tens of megabytes,
which would be silly to decode-then-reencode. `RawGet` + `io.Copy` keeps
the data on the wire until it hits disk.

## `aju mcp serve` — retired stub

The subcommand still exists (`main.go:165-177`) but prints a message
pointing users at the remote `/api/mcp` endpoint instead of running a
local server:

```
aju MCP runs as a remote HTTP endpoint:

  https://mcp.aju.sh/mcp

Add it to your MCP-capable client (Claude Desktop, Claude.ai,
Cursor, OpenCode, …) using an API key from `aju keys list`.

Full setup snippets: https://aju.sh/doc/mcp
```

`client/cli/cmd/stub.go:19-29`. See [stdio-bridge.md](./stdio-bridge.md) for
the history and the one legacy case where you'd still want a local bridge.

## `aju skill install claude` and `aju skill remove claude`

`client/cli/cmd/skill.go` takes a **target** (currently only `claude`) and
drops a templated `SKILL.md` into that tool's config directory. For the
Claude Code target, the destination is `~/.claude/skills/aju/SKILL.md`.
The target name became required so that adding Cursor / Continue / other
hosts later is a simple map entry. See
[claude-code-skill.md](./claude-code-skill.md) for the full story.
