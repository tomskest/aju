# aju

The `aju` CLI is the user-facing client for the aju.sh memory service.

## Build

Requires Go 1.22 or newer.

```
make build
# or
go build -o aju ./
```

## Install locally

```
make install
```

This copies the binary to `~/.local/bin/aju`. Make sure `~/.local/bin` is on
your `PATH`.

## Quick start

```
aju login           # device-code authentication
aju skill install   # register the aju skill with Claude Code
aju help            # see all commands
```

`aju skill install` writes `~/.claude/skills/brain/SKILL.md`, which teaches
Claude Code how to call the CLI for memory operations (search, read, write,
graph).

## Commands

Working:

- `aju login` / `aju logout` / `aju status` / `aju whoami`
- `aju search <query>` — keyword search
- `aju semantic <query>` — semantic (hybrid/vector) search
- `aju read <path>` — read a note
- `aju browse <dir>` — list documents in a directory
- `aju create <path>` — create a note from stdin
- `aju update <path>` — update a note from stdin
- `aju delete <path>` — delete a note (prompts for confirmation)
- `aju self-update` — update the CLI binary in place
- `aju backlinks <path>` / `aju related <path>`
- `aju graph [--mode stats|neighbors] [--path <p>]`
- `aju brains list` / `aju brains switch <name>`
- `aju orgs list` / `aju orgs switch <slug>` / `aju orgs create <name>` / `aju orgs invite <email>` / `aju orgs members`
- `aju skill install` / `aju skill remove`
- `aju version` / `aju help`

Stubbed (not implemented yet):

- `aju news`
- `aju doctor`
- `aju mcp serve`
- `aju files list|read|upload|delete`
- `aju rebuild-links`
- `aju changes`
- `aju brains create` / `aju brains delete` — use the dashboard at aju.sh/app/brains

Most read/graph commands support `--brain <name>` and `--json`. Write commands
accept content from stdin and support `--brain <name>`.

## Configuration

Config lives at `~/.aju/config.json`. Runtime state lives at
`~/.aju/state.json`. Both are created automatically and are only readable by
your user.

Relevant fields in `config.json`:
- `server` — API base URL (default `https://aju.sh`)
- `key` — API key (set by `aju login`)
- `brain` — active brain name (set by `aju brains switch`)
- `org` — active organization slug (set by `aju orgs switch`)

## Releases

Releases are cut by pushing a git tag at the repo root.

- Tag format: `cli-vX.Y.Z` (e.g. `cli-v0.1.0`).
- Pushing the tag triggers `.github/workflows/cli-release.yml`, which
  cross-compiles `aju-darwin-arm64`, `aju-darwin-amd64`, `aju-linux-arm64`,
  `aju-linux-amd64`, generates `checksums.txt`, and publishes a GitHub Release
  with auto-generated changelog.
- The version is injected into the binary via
  `-ldflags "-X main.Version=<stripped-tag>"`, so `aju version` prints the
  release number.

End-users do not interact with the release artifacts directly. They install via:

```
curl -fsSL install.aju.sh | sh
```

The `install.aju.sh` worker resolves the right asset for their OS / arch and
verifies the sha256 against `checksums.txt` from the same release.

## License

Apache 2.0. See the repository root for the full license text.
