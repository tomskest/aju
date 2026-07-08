---
name: aju
description: Search, read, write, and recall persistent memory from {{.UserName}}'s aju brain — also referred to as {{.UserName}}'s vault, notes, journal, archive, diary, notebook, or knowledge base. {{if .BrainNames}}Known brains accessible to this machine: {{.BrainNames}}. Route "my brain"/"my vault"/"my notes" to `{{.ActiveBrain}}`, and route named-brain phrasings like "the {{.FirstBrainExample}} brain" or "{{.UserName}}'s brain" to the appropriate brain. {{end}}Use whenever the user mentions aju, brain, vault, notes, journal, memory, recall, remember, knowledge, context, archive, or notebook; or asks anything like "do you know about X", "what do we know about Y", "what did we learn", "what did I decide about", "have we seen this before", "have we talked about this", "when did we discuss", "what's our approach to", "check my brain", "check {{.UserName}}'s brain", "check my notes", "check the vault", "search my brain", "search my notes", "pull up notes on", "find notes about", "save this", "remember this", "store this in my brain", "store this in {{.UserName}}'s brain", "store this in the vault", "add this to my brain", "write this down", "log this", "jot this down", "make a note of this", "record this", "keep track of this", "continue our conversation about", "the usual", "our standard approach", or any similar phrasing about persistent memory, saved knowledge, prior context, journaling, or long-running threads.
allowed-tools: Bash
---

# aju — persistent memory

The `aju` CLI is already installed and authenticated on this machine. Use it via Bash for every memory operation. Documents are markdown files stored in brains; paths inside a brain look like `journal/2026-04-17.md` or `topics/databases.md`.

## Identity, profiles, and accessible brains

You are acting on behalf of **{{.UserName}}**{{if .UserEmail}} (`{{.UserEmail}}`){{end}}.

{{if .Profiles}}### Every aju call MUST name a profile

`aju` is strict-profile: every brain-touching command (read, browse, search, semantic, deep-search, create, update, delete, validate, files, graph, history, …) refuses to run unless a profile is named explicitly. There is no shared "active org" or "active brain" anymore — `aju orgs switch` and `aju brains switch` are retired, and there is no implicit default for brain-touching ops.

You select the profile in one of two equivalent ways on every command:

```bash
aju --profile <name> <command> ...
AJU_PROFILE=<name> aju <command> ...
```

A profile in `~/.aju/config.json` bundles (server, API key, pinned brain). Naming the profile names the org too — the API key itself is bound server-side to one org. Forgetting the flag now produces a hard error; this is by design, because silent defaults were how cross-org writes leaked.

{{range .Profiles}}### Profile `{{.Name}}`{{if .OrgName}} — {{.OrgName}}{{end}}{{if .OrgType}} ({{.OrgType}} org){{end}}

{{if .Brains}}Brains reachable with `--profile {{.Name}}`:

{{range .Brains}}- `{{.Name}}` — {{.Type}} brain, your role: {{.Role}}, {{.DocumentCount}} docs
{{end}}{{else}}No brains visible to this profile yet.
{{end}}
{{end}}### Brain types

- **Personal brains** (`personal`) live in the user's own workspace and no one else has access.
- **Org brains** (`org`) are shared inside a team. Other members may be reading and writing them too — treat them like a team wiki, not a private notebook.
- Each org has its own isolated database under the hood. `--brain a,b` and `--brain all` both span only the brains _inside one org_ (the org bound to `--profile`). Cross-org queries require running one command per profile and merging the results yourself.

### Routing user phrasing → profile + brain

- A brain name that appears under exactly one profile above → that profile's brain (pass `--profile <name> --brain <brain>`).
- A brain name that appears under multiple profiles → ASK the user which org they mean before running anything.
- A phrasing that names one of the orgs above (e.g. "the {{(index .Profiles 0).OrgName}} brain", "our team notes") → the profile that binds to that org.
- "my brain" / "my notes" / "my vault" with no qualifier → ASK which profile/brain the user means; do not guess. Picking a default is exactly the failure mode strict-profile prevents.
- A query that spans multiple orgs → run one command per relevant profile and merge results in your reply; do not try to fuse them in a single call.
- If the user names a brain that isn't in any list above, say so and offer to create it (`aju brains create <name> --profile <profile-bound-to-the-target-org>`) or pick an existing one.

Never run `aju orgs switch` or `aju brains switch` — both are retired and now print a refusal. Use `--profile` per call. The only commands that work without `--profile` are `aju login`, `aju logout`, `aju profiles {list,show,use,remove}`, `aju version`, and `aju help`.
{{else}}This skill was installed without an authenticated session — every aju command will fail until you run `aju login --profile <name>` to create a profile, then re-run `aju skill install claude --force` so this skill body picks up the routing table.
{{end}}

## Orient yourself before doing anything

On the first aju command of a session, run `aju status --profile <name>` once for the profile you're about to use. It prints the signed-in identity and server — a cheap sanity check that catches stale installs or broken auth. If it fails, stop and tell the user instead of blindly continuing.

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

Every example below shows `--profile <name>` because every brain-touching call requires it. Substitute the actual profile name from the routing table above.

```bash
aju search "<keyword>" --profile <name>            # fast FTS keyword search with snippets
aju semantic "<natural phrasing>" --profile <name> # meaning-based, catches paraphrases
aju deep-search "<question>" --profile <name>      # GraphRAG: hybrid seeds + 1–2 hop graph expansion
aju browse <dir> --profile <name>                  # list docs under a directory prefix
```

**Preferred default: run `search` and `semantic` in parallel in a single tool call.** Keyword and meaning-based retrieval catch different things — running both costs ~200ms total but avoids missed hits from paraphrasing. Merge the results, dedupe by path, pick the best.

Example of the parallel pattern:

```bash
# Run both at once in the background, then read results
aju search "pgvector indexing" --profile <name> &
aju semantic "how we speed up vector queries" --profile <name> &
wait
```

**Reach for `deep-search` when the question spans multiple connected ideas** ("how does X relate to Y?", "what's the whole picture around Z?", "what have I been thinking about Q over time?"). It starts from hybrid FTS+semantic seeds and walks the wikilink graph 1–2 hops, surfacing related docs the user didn't directly match. Slower than search/semantic — use it as escalation, not a default.

If all three return nothing, the memory doesn't exist yet. Don't fabricate.

Add `--limit <n>` to cap results. `--brain` accepts a single name, a comma-separated list (`--brain personal,work`), or `all` to search every accessible brain in the org bound to `--profile`. When multiple brains are searched, `aju search` and `aju semantic` fuse candidates in a single cross-brain RRF pass so scores are directly comparable, and each result row prefixes the snippet with `[brain-name]`. `deep-search` also accepts `--seeds <n>` (default 5), `--depth 1|2` (default 1), and `--section/--type` filters.

**Cross-org queries.** `--brain all` and `--brain a,b` span only the brains in the org bound to `--profile`. For a question that spans multiple orgs, run one command per relevant profile (each with its own `--profile`) and merge results in your reply. There is no single-call cross-org search.

## Provenance & validation states

Every search / semantic / deep-search result includes a `validation` block:

- `status`: `validated` | `unvalidated` | `stale` | `disqualified`
- `provenance`: `human` (typed by the user), `agent` (LLM-written), `ingested` (imported from a transcript / external doc)
- `validatedAt`, `validatedBy`: when and by whom the doc was last vouched for
- `staleByTime`: true when the validation is older than the brain's half-life (default 180 days)

How to read these when grounding your answers:

- `validated` → trust as fact. Cite directly without hedging.
- `validated` + `staleByTime: true` → likely true; mention the age when the user is making a decision ("validated last May, may be worth re-confirming").
- `unvalidated` + `provenance: human` → user wrote it but didn't review. Medium trust. Phrase as "according to a note from <date>" rather than as fact.
- `unvalidated` + `provenance: agent` → AI-generated, not yet reviewed. Low trust. Cite as such ("an earlier agent run noted…").
- `stale` → text changed after a previous validation. Treat as unvalidated; mention the staleness if you cite it.
- `disqualified` → never appears in default search. Only surfaces with `--include-disqualified`. Do NOT cite as evidence — the user has flagged this as wrong.

Default search already excludes `disqualified` and ranks `validated` higher. Use `--facts` for strict mode (only validated). Use `--provenance human` to filter out agent-authored noise.

After the user confirms a fact you saved, validate it so future retrieval treats it as canonical:

```bash
aju validate <path> --profile <name>            # mark as validated
aju mark-stale <path> --profile <name>          # flag content as out of date
aju disqualify <path> --profile <name>          # exclude from future search (wrong/false)
aju clear-validation <path> --profile <name>    # reset to unvalidated
aju validation status <path> --profile <name>   # show current state + history
```

## Reading a document

```bash
aju read <path> --profile <name>          # prints frontmatter + body
aju read <path> --json --profile <name>   # machine-readable form
```

## Writing new memory

Prefer stdin redirection for multi-line content. The profile flag goes on the `aju create` invocation that consumes the heredoc:

```bash
cat <<'EOF' | aju create topics/vector-search.md --profile <name>
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
- **Diagrams.** Fenced ` ```mermaid ` and ` ```bpmn ` code blocks render as diagrams in the web app. A ` ```bpmn ` block must be complete BPMN 2.0 XML _including_ the `bpmndi:BPMNDiagram` layout section (bpmn-js does no auto-layout — every element needs a `BPMNShape`/`BPMNEdge` with coordinates). Size each task box to its name: keep labels to two lines and give the box ~6px per character per line plus 20px padding, or the text collides with the task's type icon. Working skeleton: `aju read` the public KB page at aju.sh/kb/data/diagrams, or copy from an existing process doc. Plain ` ```xml ` blocks are never rendered.

### Updating existing memory

`update` replaces the full document. To append or modify, read first. Keep `--profile` consistent on read and update — they must target the same profile or you'll edit a doc you didn't read:

```bash
current="$(aju read topics/vector-search.md --profile <name>)"
cat <<EOF | aju update topics/vector-search.md --profile <name>
$current

## Update 2026-04-17

Switched to voyage-4-large from text-embedding-3-small. Notes: [[2026-04-17-embedding-swap]].
EOF
```

### Deleting

```bash
aju delete <path> --profile <name>            # deletes the document
aju delete <path> --yes --profile <name>      # skip confirmation
```

Delete sparingly. Prefer archiving (move content to `archive/<path>.md`) if historical context might matter.

## Graph navigation

```bash
aju backlinks <path> --profile <name>                  # what links TO this doc
aju related <path> --profile <name>                    # related (shared tags + graph proximity)
aju graph --profile <name>                             # vault stats: totals, most-linked docs
aju graph --mode neighbors --path <p> --profile <name> # 2-hop ego network around a doc
```

Use these to walk from one memory to adjacent memories — "show me everything connected to X" is usually `aju read X --profile <name> && aju related X --profile <name> && aju backlinks X --profile <name>`.

## Files (binaries)

```bash
aju files list --profile <name>                              # list uploaded files
aju files read <key> --profile <name>                        # metadata + extracted text
aju files read <key> --mode url --profile <name>             # presigned download URL
aju files read <key> --mode content --profile <name>         # base64 file content
aju files upload <local-path> --profile <name>               # upload a binary (PDF, image, etc.)
aju files delete <key> --profile <name>                      # remove a file
```

PDFs are text-extracted automatically and searchable via `aju search`. Images store EXIF/metadata and can be retrieved via presigned URL for later analysis.

## Multi-brain context within one profile

Each profile is bound to one org. Within that org, a profile can reach multiple brains. Single-brain commands accept `--brain <name>`; search commands also accept comma-separated lists or `all`:

```bash
aju search "incident" --brain work --profile <name>
cat <<< "..." | aju create notes/onboarding.md --brain work --profile <name>

aju search "incident" --brain personal,work --profile <name>      # two named brains, one org
aju semantic "NDC parity" --brain all --profile <name>            # every brain in this profile's org
```

With multiple brains, server-side RRF fuses all candidates into one ranked list (scores are comparable, no client-side merging needed). Results are prefixed with `[brain-name]` so you can see which brain each hit came from. Mutating commands (`create`, `update`, `delete`, `files *`) stay single-brain because a document lives in exactly one brain.

If the profile pins a default brain, `--brain` may be omitted on single-brain ops; the profile's pinned brain is used. When in doubt, pass `--brain` explicitly.

Manage brains within a profile's org:

```bash
aju brains list --profile <name>                  # show brains reachable with this profile
aju brains create <new-name> --profile <name>     # create a brain in this profile's org
```

`aju brains switch` is retired — to use a different brain, pass `--brain` on the call or use a different `--profile`.

## Recent changes

```bash
aju changes --profile <name>                                 # default: last 24h of mutations
aju changes --since 2026-04-01T00:00:00Z --profile <name>    # explicit cutoff (ISO 8601)
aju rebuild-links --profile <name>                           # re-parse wikilinks + rebuild edge table
```

Useful when the user asks "what did I add yesterday?" or "what's new since Monday?".

## Export

```bash
aju export -o my-export.json --profile <name>     # full portable JSON of one profile's data
```

Always available, even after the beta ends. Useful when the user wants a local copy of everything.

## Common workflows

In every workflow below, pick the profile that matches the user's intent (see the routing table above). Substitute the actual profile name for `<name>`.

### "What do we know about X?"

```bash
# Run these two in parallel in one tool call:
aju search "X" --profile <name>
aju semantic "X" --profile <name>
# Then:
aju read <top_path> --profile <name>           # read the best match
aju related <top_path> --profile <name>        # adjacent context
```

### "Add this to my research brain: <paper / finding / idea>"

```bash
# 1. Check the research brain first
aju search "<topic>" --brain research --profile <name>
aju semantic "<natural phrasing>" --brain research --profile <name>

# 2a. If an existing note fits: read → compose → update
aju read topics/<slug>.md --brain research --profile <name>
# ...append new section with date + wikilinks...
aju update topics/<slug>.md --brain research --profile <name>

# 2b. If nothing fits: create a stable-path note
cat <<'EOF' | aju create topics/<slug>.md --brain research --profile <name>
---
tags: [research, <domain>]
source: claude-code
---
# <Title>

<Content with [[wikilinks]] to existing notes>
EOF
```

Target the brain that matches the user's intent — research findings go in `research`, personal thoughts in a personal brain, team decisions in a team org brain. The profile decides the org; `--brain` decides the brain within that org.

### "What's the whole picture around X?" (multi-hop / synthesis)

```bash
aju deep-search "<full question>" --profile <name>     # returns seeds + graph neighbors in one call
# results tagged S (seed) or G1/G2 (graph hop distance); read the top few and synthesize
```

### "Remember this: <decision or fact>"

1. Search first: `aju search "<topic>" --profile <name>` and `aju semantic "<natural phrasing>" --profile <name>`
2. If an existing doc fits: `aju read <path> --profile <name>` → compose updated content → `aju update <path> --profile <name>`
3. If no doc fits: choose a stable path (`topics/<slug>.md` or `decisions/<slug>.md`) → `aju create <path> --profile <name>` with frontmatter, body, and wikilinks to related docs

### "What did I decide about X?"

```bash
aju search "X" --profile <name>
aju browse decisions/ --profile <name>                  # if the user uses a decisions/ convention
aju semantic "why did I choose X" --profile <name>
```

### "Show me yesterday's notes"

```bash
aju browse journal/ --profile <name>
aju read journal/2026-04-16.md --profile <name>
```

### "Continue our conversation about X"

```bash
aju search "X" --profile <name>
aju read <path> --profile <name>           # pull the last thread
# … continue the conversation …
aju update <path> --profile <name>         # append the new turn, with wikilinks
```

### "How did this document come to exist?"

```bash
aju changes --since 2026-01-01T00:00:00Z --profile <name>  # see when paths were created or modified
aju backlinks <path> --profile <name>                      # what else points here
```

## Admin commands (rarely needed by agents)

These exist but most agent tasks should NOT use them without explicit user request. They also require `--profile`:

- `aju orgs list|create|invite|members --profile <name>` — organization management (no `switch` — retired)
- `aju agents list|create|show|pause|resume|revoke|grant|activity --profile <name>` — agent principals
- `aju keys list|create|revoke --profile <name>` — API keys (creating a new key returns a plaintext that's only shown once)
- `aju files upload --profile <name>` (for large uploads, consider user confirmation)
- `aju mcp serve --profile <name>` — MCP server (the CLI is the primary interface; MCP is for other hosts)

Treat these as user actions.

## System / diagnostics

```bash
aju version
aju status --profile <name>               # server, signed-in identity for one profile
aju whoami --profile <name>               # email only
aju doctor --profile <name>               # full environment + connectivity check
aju profiles list                         # inventory all profiles (no --profile needed)
aju help                                  # command overview
aju help <command>                        # per-command usage
aju self-update                           # update the CLI binary to latest release
aju news --profile <name>                 # product announcements
```

The only commands that work without `--profile` are `aju login`, `aju logout`, `aju profiles {list,show,use,remove}`, `aju version`, and `aju help`.

## Do

- Pass `--profile <name>` on every brain-touching call. The CLI will refuse without it. Pick the profile from the routing table above.
- After the user confirms a fact you saved, run `aju validate <path> --profile <name>` so future retrieval treats it as canonical.
- When a search result you're about to cite has `validation.status: stale` or `unvalidated + provenance: agent`, surface that uncertainty in your answer — don't quietly downgrade.

## Do NOT

- Run `aju` brain-touching commands without `--profile`. They will fail; this is by design (silent defaults were the source of cross-org leaks).
- Run `aju orgs switch` or `aju brains switch` — both are retired and now print a refusal.
- Pick a profile by guessing when the user's phrasing is ambiguous ("my brain", "our notes" without an org clue). Ask first.
- Dump raw conversation transcripts wholesale. Summarise, reference, link.
- Create duplicate documents when an existing one fits. `update` the existing one.
- Use throwaway paths like `tmp/<random>.md` — memory should be findable later.
- Create brains, API keys, or organizations unprompted. Those are user actions.
- Skip the search-before-write step. Never write a doc without first running `aju search` (and ideally `aju semantic` in parallel).
- Write secrets (API keys, passwords, tokens) into the brain. It is a note store, not a password manager.
- Overwrite an existing document without first reading its current content (`aju read --profile <name>`, compose locally, then `aju update --profile <name>`).
- Delete documents without explicit user permission.
- Write personal notes into an org brain or team notes into a personal brain. If the right target is ambiguous, ask.

## Output conventions

Every aju command writes machine-readable output to stdout and errors to stderr. Non-zero exit codes indicate failure. Parse JSON output with `--json` where available. Most commands return short tabular output by default that's grep- and awk-friendly.

## Access roles

Brains and organizations have three role levels. When a user asks "can I edit this?" or "who can see this?", the answer depends on their role in the relevant brain or org:

| Role       | Can do                                                                            |
| ---------- | --------------------------------------------------------------------------------- |
| **owner**  | Read, write, delete, invite members, revoke members, rename, delete the brain/org |
| **editor** | Read, write, delete documents                                                     |
| **viewer** | Read only                                                                         |

Use `aju status --profile <name>` to see the signed-in identity for that profile. Use `aju brains list --profile <name>` to see roles across the brains reachable with that profile. Use `aju orgs list --profile <name>` for org-level roles.
