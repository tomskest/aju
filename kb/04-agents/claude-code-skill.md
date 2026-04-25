---
title: The Claude Code skill
description: What `aju skill install claude` drops onto disk, how it's personalized, and why it talks to the CLI instead of MCP.
order: 50
---

# The Claude Code skill

Claude Code auto-discovers any `SKILL.md` under `~/.claude/skills/` on
startup. The `aju skill install claude` subcommand writes one such file
into `~/.claude/skills/aju/SKILL.md`, templated against the current
user's identity and brain list.

The `claude` positional is the install **target**. Currently only one
target is registered (`client/cli/cmd/skill.go:49-57`), but the subcommand
is already structured as a target map so adding `cursor`, `cline`,
`continue`, etc. later is a matter of appending an entry.

## Install path

Hard-coded in `client/cli/cmd/skill.go:150-156` (the `claudeSkillPath` func
registered as the `claude` target):

```go
func claudeSkillPath() (string, error) {
    home, err := os.UserHomeDir()
    if err != nil {
        return "", fmt.Errorf("resolve home directory: %w", err)
    }
    return filepath.Join(home, ".claude", "skills", "aju", "SKILL.md"), nil
}
```

So: `~/.claude/skills/aju/SKILL.md`, directory mode `0755`, file mode
`0644`. No other files are written — the skill is a single markdown file
by design. Claude Code supports skill bundles with additional assets, but
aju's skill is self-contained.

## Install flow

`SkillInstall` (`client/cli/cmd/skill.go:180-229`):

1. Resolve the target name (`claude` by default; required positional in
   practice — `aju skill install claude`).
2. Build a `skillContext` by calling `GET /api/auth/me` and
   `GET /api/brains`. The calls use the **active profile's** key, so the
   listed brains are the ones belonging to that profile's org. If the
   caller isn't signed in, proceed with generic placeholders.
3. Render the target's template (for `claude`: the embedded
   `skill_body.md`, a Go `text/template`) into a string.
4. `os.MkdirAll` the directory.
5. If `SKILL.md` already exists and `--force` wasn't passed, bail with a
   notice.
6. Write the file.
7. Print a confirmation including the user's name, email, and the active
   brain.

The template source is embedded via `go:embed`:

```go
//go:embed skill_body.md
var skillBodyTemplate string
```

`client/cli/cmd/skill.go:19-20`. Editing `client/cli/cmd/skill_body.md` and
rebuilding the binary is the only way to change what the skill says.

## The template context

`client/cli/cmd/skill.go:29-36`:

```go
type skillContext struct {
    UserName          string
    UserEmail         string
    ActiveBrain       string
    Brains            []skillBrain      // name, type, role, documentCount
    BrainNames        string            // comma-joined, quoted
    FirstBrainExample string
}
```

`UserName` prefers the `name` field from `/api/auth/me`, falling back to
the email local-part (`skill.go:91-102`). `ActiveBrain` is the active
profile's `Brain` if set via `aju brains switch`, else the first brain
returned by `/api/brains`. The brain list comes from the **same org** the
active profile's key is pinned to — if you want a skill personalized for
a different org, switch profiles first (`aju profiles use <name>`) and
re-run `aju skill install claude --force`.

## What the rendered skill contains

Source: `client/cli/cmd/skill_body.md`. Key parts:

### Frontmatter

```yaml
---
name: aju
description: Search, read, write, and recall persistent memory from {{.UserName}}'s aju brain — also referred to as {{.UserName}}'s vault, notes, journal, archive, diary, notebook, or knowledge base. …
allowed-tools: Bash
---
```

`skill_body.md:1-5`. `allowed-tools: Bash` is the only tool the skill
needs — every memory operation happens via `aju` CLI subprocesses.

### Identity + brain routing

The skill is personalized at install time:

```
You are acting on behalf of **{{.UserName}}** (`{{.UserEmail}}`).

Active brain: `{{.ActiveBrain}}`

Brains this machine has access to:

- `personal` — personal brain, your role: owner, 312 docs
- `work` — org brain, your role: editor, 41 docs
```

Plus explicit routing rules (`skill_body.md:22-27`):

- "my brain" / "my vault" / "my notes" → the active brain
- "<UserName>'s brain" → the active brain
- Fuzzy matches against the listed names → that brain
- Unknown brain names → ask the user

**Why bake the list in:** the LLM otherwise has to fish the brain list out
of `aju brains list` every time. Embedding the list (and re-rendering
with `--force` when it changes) removes one round-trip and makes the
routing deterministic.

### Core principle (3 rules)

`skill_body.md:38-42`:

1. Search before writing.
2. Update, don't duplicate.
3. Link generously.

These three rules encode the behavioral difference between a scratchpad
and a real notebook. Everything else in the skill reinforces them.

### Command cheatsheets

Dense usage examples for each workflow:

- Search — `aju search`, `aju semantic`, `aju browse` (run `search` +
  `semantic` in parallel by default)
- Deep search — `aju deep-search <question>` as the third retrieval
  mode, positioned as escalation from `search`+`semantic` for multi-hop
  or synthesis questions ("how does X relate to Y?", "what's the whole
  picture around Z?"). Results are tagged `S` (seed) or `G1`/`G2` (graph
  hop) so the agent can read the top few and synthesize. Flags mirror
  the CLI: `--seeds`, `--depth 1|2`, `--section`, `--type`
- Read — `aju read <path>` (+ `--json`)
- Write — `aju create` / `aju update` via stdin heredoc, with explicit
  path-naming conventions (`topics/<slug>.md`, `journal/<YYYY-MM-DD>.md`,
  `decisions/<slug>.md`)
- Graph — `aju backlinks`, `aju related`, `aju graph [--mode neighbors]`
- Files — `aju files list / read / upload / delete`
- Multi-brain — `--brain <name>` on every command

### "Do NOT" guardrails

`skill_body.md:244-253`:

- Don't dump raw transcripts — summarize and link.
- Don't create duplicate documents.
- Don't use throwaway paths (`tmp/<random>.md`).
- Don't create brains, API keys, or organizations unprompted.
- Don't skip the search-before-write step.
- Don't write secrets into the brain.
- Don't overwrite a document without reading it first.
- Don't delete without explicit user permission.

These are tripwires. Past agent behavior suggests models will happily
duplicate notes or nuke documents when given overly broad permission —
being explicit costs nothing and measurably improves behavior.

## Why skill-over-bash instead of MCP

From `src/app/doc/claude-code/page.tsx:87-158` — the public docs spell out
the tradeoff, but the short version:

- **Zero config.** The skill lives at a fixed path Claude Code already
  scans. No editing `~/Library/Application Support/Claude/claude_desktop_config.json`,
  no restart loop.
- **One file covers every brain.** The CLI handles brain selection
  locally (`~/.aju/config.json`). An MCP config would need a separate
  `url` + `Authorization` per brain, or every tool call would need an
  explicit `brain` arg.
- **Works offline for setup.** Once `aju login` has run, the skill
  installs without any server round-trip for the install step (the
  personalization calls are best-effort — a disconnected install just
  renders generic placeholders).
- **Matches the shell-first mental model.** Claude Code already has a
  Bash tool. Routing through a subprocess is the path of least
  resistance.

The public pitch in `docs/claude-code/page.tsx:176-186`: "Skills cover
95% of use cases. If you need tighter integration or are wiring up a
non-Claude client, see the MCP page."

## Removal

`SkillRemove` (`client/cli/cmd/skill.go:235-267`) deletes
`~/.claude/skills/aju/SKILL.md` and the parent directory if empty. No
server call. Reinstall with `aju skill install claude`.

## When to re-run `aju skill install claude --force`

The template captures the user's identity and brains at install time. If
you:

- Create a new brain (`aju brains create work`)
- Switch the active brain (`aju brains switch work`)
- Switch profiles to talk to a different organization
  (`aju profiles use <name>`)

…then re-run `aju skill install claude --force` to refresh the embedded
list. The install output reminds you explicitly:

> Re-run `aju skill install claude --force` after changing brains to refresh.

`client/cli/cmd/skill.go:226`.
