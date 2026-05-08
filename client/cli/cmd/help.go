package cmd

import "fmt"

// Help prints the top-level command overview.
func Help() {
	fmt.Print(`aju — CLI for aju.sh memory service

Usage:
  aju <command> [arguments]

Authentication:
  login                    Sign in via device code flow
  agent-provision <name>   Mint an agent-scoped key for this machine (device code flow)
  logout                   Remove the stored API keys
  status                   Show server, profile-pinned brain, and sign-in state
  whoami                   Print the signed-in identity (exit 1 if not signed in)

Strict-profile model: every brain-touching command requires --profile <name>
(or AJU_PROFILE=<name>). The CLI no longer carries a shared "active org" or
"active brain" — each profile pins its own (server, key, brain). The only
commands that work without --profile are login, logout, profiles list/show/
use/remove, version, and help.

Memory:
  search <query>        Keyword search across the vault
  semantic <query>      Semantic search (hybrid by default)
  deep-search <query>   GraphRAG: hybrid seeds + graph expansion (--depth 1|2; --brain a,b or all)
  read <path>           Read a note (frontmatter + body)
  browse <dir>          Browse a directory of notes
  create <path>         Create a note from stdin
  update <path>         Update a note from stdin
  delete <path>         Delete a note (prompts; --yes to skip)

Graph:
  backlinks <path>      Show documents that link to <path>
  related <path>        Show related documents (links + shared tags)
  graph                 Show graph stats (--mode neighbors --path <p> for ego-net)
  rebuild-links         Rebuild the link index
  auto-link             Insert [[wikilinks]] for mentions of other docs (idempotent)
  reindex               Repopulate FTS, embeddings, and links for the profile's brain
  changes               Show recent changes (--since, --exclude-source, --limit; --brain a,b or all)
  history <path>        Show the version history of a document (--version N | --hash <hex> for content)

Brains:
  brains list                    List brains reachable with --profile (profile-pinned brain marked with *)
  brains create <name>           Create a brain in the profile's org (--type personal|org)
  brains delete <name>           Delete a brain (confirms; --yes to skip). Refuses to delete your only owned brain.
  brains share <name> <email>    Grant a user access to a brain (--role viewer|editor|owner). Owner-only.
  brains unshare <name> <email>  Revoke a user's access. Owner-only.
  brains members <name>          List explicit user grants on a brain.

Organizations:
  orgs list             List organizations the profile's key can reach
  orgs create <name>    Create an organization
  orgs invite <email>   Invite a user to the profile's org (--role member|admin|owner)
  orgs members          List members of the profile's org

Agents:
  agents list                     List agents in the profile's organization
  agents create <name>            Create an agent (--description "...")
  agents show <id>                Show agent detail + brain grants
  agents pause <id>               Pause an active agent
  agents resume <id>              Resume a paused agent
  agents revoke <id>              Revoke an agent (prompts; --yes to skip)
  agents grant <id> <brain>       Grant agent access to a brain (--role viewer|editor|owner)
  agents activity <id>            List recent change-log events for an agent (--limit 50)
  agents keys create <id> <name>  Mint a key that authenticates AS the agent (--scopes read,write --expires-days 90)
  agents keys list <id>           List API keys for an agent
  agents keys revoke <id> <key>   Revoke an agent key by id or prefix (--yes to skip prompt)

API Keys:
  keys list                       List your API keys (prefix, name, org, scopes, last used, status)
  keys create <name>              Mint a new key pinned to an org (--org <slug> --scopes read,write --expires-days 90)
  keys revoke <id-or-prefix>      Revoke a key (prompts; --yes to skip)

Profiles (local per-machine, one key + one org + one brain each):
  profiles list                   List all configured profiles (active is marked with *)
  profiles show                   Print the active profile's details
  profiles use <name>             Make <name> the default profile (display-only;
                                  brain-touching ops still require --profile per call)
  profiles remove <name>          Delete a local profile (does NOT revoke the server key)

Required: 'aju -p <name> <command>' or AJU_PROFILE=<name> on every brain-
touching call. There is no implicit default — the CLI errors without it.

Files:
  files list            List files (--category <c> --json)
  files read <key>      Read a file (--mode metadata|url|content --output <path>)
  files upload <path>   Upload a file (--category <c> --tags a,b,c)
  files delete <key>    Delete a file (prompts; --yes to skip)

Editor / agent integrations:
  skill install <tool>  Install the aju skill into a target tool (e.g. claude)
  skill remove <tool>   Remove the installed skill from a target tool
  skill list            List supported skill targets

Server integrations:
  mcp serve             Run MCP server (not implemented yet)

Self-management:
  self-update           Update the CLI binary (--force to reinstall)
  news                  Show product announcements (--all to replay seen)
  doctor                Diagnose local environment and connectivity
  export [-o path]      Download a portable JSON export of your data

Utilities:
  version               Print the CLI version
  help                  Print this help message

Global flags (where supported):
  --profile <name>      Required for brain-touching commands; selects (server, key, brain).
                        Equivalent: AJU_PROFILE=<name>.
  --brain <name>        Target a specific brain (overrides the profile's pinned brain)
  --json                Emit raw JSON instead of human-readable output

Run 'aju <command> --help' for details on a command.
`)
}
