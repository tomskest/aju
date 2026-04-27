---
name: aju
description: Search, read, write, and recall persistent memory from {{.UserName}}'s aju brain — also referred to as {{.UserName}}'s vault, notes, journal, archive, diary, notebook, or knowledge base. {{if .BrainNames}}Known brains accessible to this machine: {{.BrainNames}}. Route "my brain"/"my vault"/"my notes" to `{{.ActiveBrain}}`, and route named-brain phrasings like "the {{.FirstBrainExample}} brain" or "{{.UserName}}'s brain" to the appropriate brain. {{end}}Use whenever the user mentions aju, brain, vault, notes, journal, memory, recall, remember, knowledge, context, archive, or notebook; or asks anything like "do you know about X", "what do we know about Y", "what did we learn", "what did I decide about", "have we seen this before", "have we talked about this", "when did we discuss", "what's our approach to", "check my brain", "check {{.UserName}}'s brain", "check my notes", "check the vault", "search my brain", "search my notes", "pull up notes on", "find notes about", "save this", "remember this", "store this in my brain", "store this in {{.UserName}}'s brain", "store this in the vault", "add this to my brain", "write this down", "log this", "jot this down", "make a note of this", "record this", "keep track of this", "continue our conversation about", "the usual", "our standard approach", or any similar phrasing about persistent memory, saved knowledge, prior context, journaling, or long-running threads.
allowed-tools: Bash
---

# aju — persistent memory

The `aju` CLI is already installed and authenticated on this machine. Use it via Bash for every memory operation. Documents are markdown files stored in brains; paths inside a brain look like `journal/2026-04-17.md` or `topics/databases.md`.

## Identity + accessible brains

You are acting on behalf of **{{.UserName}}**{{if .UserEmail}} (`{{.UserEmail}}`){{end}}.

{{if .Brains}}Active brain: `{{.ActiveBrain}}`

Brains this machine has access to:

{{range .Brains}}- `{{.Name}}` — {{.Type}} brain, your role: {{.Role}}, {{.DocumentCount}} docs
{{end}}

### Brain types and organization context

- **Personal brains** (`personal`) live in the user's own workspace and no one else has access.
- **Org brains** (`org`) are shared inside a team. Other members may be reading and writing them too — treat them like a team wiki, not a private notebook.
- Each org has its own isolated database under the hood; brains from different orgs never appear in the same search unless the user explicitly passes `--brain a,b`.

### Routing brain names in user intent

- "my brain" / "my vault" / "my notes" (no qualifier) → `{{.ActiveBrain}}`
- "{{.UserName}}'s brain" → `{{.ActiveBrain}}`
- Any exact or fuzzy match against the brain names above → that brain (pass `--brain <name>`)
- "the team brain" / "our brain" / "our shared notes" → the first `org`-type brain in the list, or ask which one if there are multiple.
- If the user names a brain that isn't in the list above, say so and ask if they want to create it (`aju brains create <name>`) or pick an existing one.
{{else}}Active brain: `brain` (assumed — skill was installed without an authenticated session, re-run `aju skill install claude --force` after `aju login` to personalize).
{{end}}

## Orient yourself before doing anything

On the first aju command of a session, run `aju status` once. It prints the signed-in identity, active brain, and server — a cheap sanity check that catches stale installs, broken auth, or an unexpected active-brain switch. If `aju status` fails or returns unexpected context, stop and tell the user instead of blindly continuing.

## What the user wants

$ARGUMENTS

(This is the literal phrasing that triggered this skill. Treat it as the target intent and resolve it via the commands below.)

## Core principle

Aju is the user's persistent memory — treat it like a real notebook, not a scratchpad. Four rules, in order:

1. **Search before writing.** You don't know what's already there. Running `aju search` and `aju semantic` in parallel is the default.
2. **Update, don't duplicate.** If a doc on this topic exists, expand it with a dated section rather than creating a sibling.
3. **Link generously.** Wikilinks build the graph; the graph is what makes retrieval good six months from now.
4. **Pick the right brain.** Personal decisions go in a personal brain. Team knowledge goes in an org brain. When unsure, ask.

## Search before anything else

```bash
aju search "<keyword>"                    # fast FTS keyword search with snippets
aju semantic "<natural phrasing>"         # meaning-based, catches paraphrases
aju deep-search "<question>"              # GraphRAG: hybrid seeds + 1–2 hop graph expansion
aju browse <dir>                          # list docs under a directory prefix
```

**Preferred default: run `search` and `semantic` in parallel in a single tool call.** Keyword and meaning-based retrieval catch different things — running both costs ~200ms total but avoids missed hits from paraphrasing. Merge the results, dedupe by path, pick the best.

Example of the parallel pattern:
```bash
# Run both at once in the background, then read results
aju search "pgvector indexing" &
aju semantic "how we speed up vector queries" &
wait
```

**Reach for `deep-search` when the question spans multiple connected ideas** ("how does X relate to Y?", "what's the whole picture around Z?", "what have I been thinking about Q over time?"). It starts from hybrid FTS+semantic seeds and walks the wikilink graph 1–2 hops, surfacing related docs the user didn't directly match. Slower than search/semantic — use it as escalation, not a default.

If all three return nothing, the memory doesn't exist yet. Don't fabricate.

Add `--limit <n>` to cap results. `--brain` accepts a single name, a comma-separated list (`--brain personal,work`), or `all` to search every accessible brain in the active org. When multiple brains are searched, `aju search` and `aju semantic` fuse candidates in a single cross-brain RRF pass so scores are directly comparable, and each result row prefixes the snippet with `[brain-name]`. `deep-search` also accepts `--seeds <n>` (default 5), `--depth 1|2` (default 1), and `--section/--type` filters.

**Cross-org caveat.** `--brain all` spans only the *active* org's brains. If the user belongs to multiple orgs (e.g., personal + a work team), switching orgs is a separate step: `aju orgs switch <slug>`.

## Reading a document

```bash
aju read <path>                           # prints frontmatter + body
aju read <path> --json                    # machine-readable form
```

## Writing new memory

Prefer stdin redirection for multi-line content:

```bash
cat <<'EOF' | aju create topics/vector-search.md
---
tags: [search, embeddings, pgvector]
source: claude-code
---
# Vector search

We use pgvector's HNSW index with voyage-4-large embeddings (1024 dims).
Hybrid search combines this with FTS via reciprocal rank fusion.

Related: [[RAG]], [[embeddings]], [[graph-retrieval]]
EOF
```

### Writing well

- **Stable paths.** `topics/<slug>.md` for concept docs. `journal/<YYYY-MM-DD>.md` for date-stamped notes. `decisions/<slug>.md` for choices-with-reasoning. `inbox/<slug>.md` only for unsorted dumps you'll organise later. Avoid random suffixes.
- **Frontmatter.** At minimum `tags: [...]` for filtering. Consider `source: claude-code` so humans can see agent-written content. `title:` overrides the first H1 for display.
- **Wikilinks.** `[[Like This]]` creates graph edges automatically. Link to related docs instead of rewriting context. Linked docs don't have to exist yet — dangling links resolve when the target is written later.
- **Titles short and stable.** If you rename a document heavily, backlinks can drift.
- **One idea per file.** Split sprawling notes into topic files linked together.

### Updating existing memory

`update` replaces the full document. To append or modify, read first:

```bash
current="$(aju read topics/vector-search.md)"
cat <<EOF | aju update topics/vector-search.md
$current

## Update 2026-04-17

Switched to voyage-4-large from text-embedding-3-small. Notes: [[2026-04-17-embedding-swap]].
EOF
```

### Deleting

```bash
aju delete <path>                         # deletes the document
aju delete <path> --yes                   # skip confirmation
```

Delete sparingly. Prefer archiving (move content to `archive/<path>.md`) if historical context might matter.

## Graph navigation

```bash
aju backlinks <path>                      # what links TO this doc
aju related <path>                        # related (shared tags + graph proximity)
aju graph                                 # vault stats: totals, most-linked docs
aju graph --mode neighbors --path <p>     # 2-hop ego network around a doc
```

Use these to walk from one memory to adjacent memories — "show me everything connected to X" is usually `aju read X && aju related X && aju backlinks X`.

## Files (binaries)

```bash
aju files list                            # list uploaded files
aju files read <key>                      # metadata + extracted text
aju files read <key> --mode url           # presigned download URL
aju files read <key> --mode content       # base64 file content
aju files upload <local-path>             # upload a binary (PDF, image, etc.)
aju files delete <key>                    # remove a file
```

PDFs are text-extracted automatically and searchable via `aju search`. Images store EXIF/metadata and can be retrieved via presigned URL for later analysis.

## Multi-brain context

Users may own multiple brains (e.g., `brain` for personal, `work` for team). Every read/write command accepts `--brain <name>`:

```bash
aju search "incident" --brain work
cat <<< "..." | aju create notes/onboarding.md --brain work
```

Search commands additionally support spanning brains in a single call:

```bash
aju search "incident" --brain personal,work        # two named brains
aju semantic "NDC parity" --brain all              # every accessible brain
```

With multiple brains, server-side RRF fuses all candidates into one ranked list (scores are comparable, no client-side merging needed). Results are prefixed with `[brain-name]` so you can see which brain each hit came from. Mutating commands (`create`, `update`, `delete`, `files *`) stay single-brain because a document lives in exactly one brain.

Manage brains:
```bash
aju brains list                           # show all accessible brains
aju brains switch <name>                  # change the default brain for this CLI
aju brains create <name>                  # create a new brain (owner: current user)
```

Without `--brain`, commands target the currently active brain. `aju status` shows which one.

## Recent changes

```bash
aju changes                               # default: last 24h of mutations
aju changes --since 2026-04-01T00:00:00Z  # explicit cutoff (ISO 8601)
aju rebuild-links                         # re-parse wikilinks + rebuild edge table
```

Useful when the user asks "what did I add yesterday?" or "what's new since Monday?".

## Export

```bash
aju export -o my-export.json              # full portable JSON of the user's data
```

Always available, even after the beta ends. Useful when the user wants a local copy of everything.

## Common workflows

### "What do we know about X?"
```bash
# Run these two in parallel in one tool call:
aju search "X"
aju semantic "X"
# Then:
aju read <top_path>                       # read the best match
aju related <top_path>                    # adjacent context
```

### "Add this to my research brain: <paper / finding / idea>"
```bash
# 1. Check the research brain first
aju search "<topic>" --brain research
aju semantic "<natural phrasing>" --brain research

# 2a. If an existing note fits: read → compose → update
aju read topics/<slug>.md --brain research
# ...append new section with date + wikilinks...
aju update topics/<slug>.md --brain research

# 2b. If nothing fits: create a stable-path note
cat <<'EOF' | aju create topics/<slug>.md --brain research
---
tags: [research, <domain>]
source: claude-code
---
# <Title>

<Content with [[wikilinks]] to existing notes>
EOF
```
Target the brain that matches the user's intent — research findings go in `research`, personal thoughts in `Personal`, team decisions in a team org brain.

### "What's the whole picture around X?" (multi-hop / synthesis)
```bash
aju deep-search "<full question>"         # returns seeds + graph neighbors in one call
# results tagged S (seed) or G1/G2 (graph hop distance); read the top few and synthesize
```

### "Remember this: <decision or fact>"

1. Search first: `aju search "<topic>"` and `aju semantic "<natural phrasing>"`
2. If an existing doc fits: `aju read <path>` → compose updated content → `aju update <path>`
3. If no doc fits: choose a stable path (`topics/<slug>.md` or `decisions/<slug>.md`) → `aju create <path>` with frontmatter, body, and wikilinks to related docs

### "What did I decide about X?"
```bash
aju search "X"
aju browse decisions/                     # if the user uses a decisions/ convention
aju semantic "why did I choose X"
```

### "Show me yesterday's notes"
```bash
aju browse journal/
aju read journal/2026-04-16.md
```

### "Continue our conversation about X"
```bash
aju search "X"
aju read <path>                           # pull the last thread
# … continue the conversation …
aju update <path>                         # append the new turn, with wikilinks
```

### "How did this document come to exist?"
```bash
aju changes --since 2026-01-01T00:00:00Z  # see when paths were created or modified
aju backlinks <path>                      # what else points here
```

## Admin commands (rarely needed by agents)

These exist but most agent tasks should NOT use them without explicit user request:

- `aju orgs list|switch|create|invite|members` — organization management
- `aju agents list|create|show|pause|resume|revoke|grant|activity` — agent principals
- `aju keys list|create|revoke` — API keys (creating a new key returns a plaintext that's only shown once)
- `aju files upload` (for large uploads, consider user confirmation)
- `aju mcp serve` — MCP server (the CLI is the primary interface; MCP is for other hosts)

Treat these as user actions.

## System / diagnostics

```bash
aju version
aju status                                # server, active brain, signed-in identity
aju whoami                                # email only
aju doctor                                # full environment + connectivity check
aju help                                  # command overview
aju help <command>                        # per-command usage
aju self-update                           # update the CLI binary to latest release
aju news                                  # product announcements
```

## Do NOT

- Dump raw conversation transcripts wholesale. Summarise, reference, link.
- Create duplicate documents when an existing one fits. `update` the existing one.
- Use throwaway paths like `tmp/<random>.md` — memory should be findable later.
- Create brains, API keys, or organizations unprompted. Those are user actions.
- Skip the search-before-write step. Never write a doc without first running `aju search` (and ideally `aju semantic` in parallel).
- Write secrets (API keys, passwords, tokens) into the brain. It is a note store, not a password manager.
- Overwrite an existing document without first reading its current content (`aju read`, compose locally, then `aju update`).
- Delete documents without explicit user permission.
- Write personal notes into an org brain or team notes into a personal brain. If the right target is ambiguous, ask.
- Switch orgs (`aju orgs switch`) or change the active brain (`aju brains switch`) without user intent — these are session-wide.

## Output conventions

Every aju command writes machine-readable output to stdout and errors to stderr. Non-zero exit codes indicate failure. Parse JSON output with `--json` where available. Most commands return short tabular output by default that's grep- and awk-friendly.

## Access roles

Brains and organizations have three role levels. When a user asks "can I edit this?" or "who can see this?", the answer depends on their role in the relevant brain or org:

| Role | Can do |
|---|---|
| **owner** | Read, write, delete, invite members, revoke members, rename, delete the brain/org |
| **editor** | Read, write, delete documents |
| **viewer** | Read only |

Use `aju status` to see the current user's role in their active brain. Use `aju brains list` to see roles across all accessible brains. Use `aju orgs list` for org-level roles.
