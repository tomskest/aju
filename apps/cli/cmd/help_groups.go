package cmd

import "fmt"

// Per-group help printers. Invoked by each RunX / dispatchX when the user
// passes `help` / `--help` / `-h`. Each block is self-contained and mirrors
// the style of the top-level Help() in help.go.

// HelpKeys prints the `aju keys` subcommand overview.
func HelpKeys() {
	fmt.Print(`aju keys — manage your personal API keys (keys that authenticate as YOU)

Usage:
  aju keys <subcommand> [flags]

Subcommands:
  list                    List your API keys (prefix, name, org, scopes, last used, status)
  create <name>           Mint a new key pinned to an org
                            --org <slug>          pin to a specific org (default: active org)
                            --scopes read,write   comma-separated: read, write, admin
                            --expires-days 90     0 = no expiry (default)
  revoke <id-or-prefix>   Revoke a key
                            --yes                 skip confirmation prompt
  update                  Reconcile local profiles against org memberships;
                          mint a fresh key for every org that lacks one
                            --yes                 accept every prompt with defaults

Examples:
  aju keys list
  aju keys create "laptop" --scopes read,write --expires-days 365
  aju keys create "prod-ci" --org acme --scopes read
  aju keys revoke ak_live_12
  aju keys update

Related:
  aju agents keys         keys that authenticate as an AGENT rather than a user
  aju profiles list       the local-side store that remembers these keys
`)
}

// HelpAgents prints the `aju agents` subcommand overview.
func HelpAgents() {
	fmt.Print(`aju agents — provision and manage org agents (non-human identities)

Usage:
  aju agents <subcommand> [flags]

Subcommands:
  list                          List agents in the active organization
  create <name>                 Create an agent
                                  --description "..."   optional description
  show <id>                     Show agent detail and its brain grants
  pause <id>                    Pause an active agent (keys keep existing, but stop working)
  resume <id>                   Resume a paused agent
  revoke <id>                   Irreversibly revoke an agent
                                  --yes                 skip confirmation prompt
  grant <id> <brain-name>       Grant agent access to a brain
                                  --role viewer|editor|owner   (default: viewer)
  activity <id>                 Recent change-log events for an agent
                                  --limit 50            max entries to return
  keys <...>                    Manage keys that authenticate AS the agent
                                (see 'aju agents keys --help')

Examples:
  aju agents create "openclaw" --description "Claude desktop on my laptop"
  aju agents grant agt_01HX... Personal --role editor
  aju agents keys create agt_01HX... "openclaw-laptop"
  aju agents activity agt_01HX... --limit 20

Related:
  aju agent-provision <name>    mint a key + write a local profile in one step
`)
}

// HelpAgentKeys prints the `aju agents keys` subcommand overview.
func HelpAgentKeys() {
	fmt.Print(`aju agents keys — manage API keys that authenticate AS an agent

Usage:
  aju agents keys <subcommand> [flags]

Subcommands:
  list <agent-id>                       List keys for an agent
  create <agent-id> <name>              Mint a key that authenticates as the agent
                                          --scopes read,write        default
                                          --expires-days 90          0 = no expiry
  revoke <agent-id> <id-or-prefix>      Revoke an agent key
                                          --yes                      skip prompt

Examples:
  aju agents keys list agt_01HX...
  aju agents keys create agt_01HX... "laptop" --scopes read,write --expires-days 90
  aju agents keys revoke agt_01HX... ak_live_12

Note:
  Agent keys are distinct from personal keys (aju keys). Both resolve against
  the same /api/keys endpoint on revoke, but agent keys are scoped to the
  agent's brain grants rather than the user's memberships.
`)
}

// HelpOrgs prints the `aju orgs` subcommand overview.
func HelpOrgs() {
	fmt.Print(`aju orgs — manage organizations and membership

Usage:
  aju orgs <subcommand> [flags]

Subcommands:
  list                   List organizations (active marked with *, local-key binding shown in last column)
  switch <slug>          Switch the server's active-org cookie. Bearer-token CLI
                         calls follow the key's pinned org, not this cookie, so
                         you may also need a profile switch — the command will
                         tell you.
  create <name>          Create an org and auto-switch into it
  invite <email>         Invite a user to the active org
                           --role member|admin|owner    (default: member)
  members                List members of the active organization

Examples:
  aju orgs list
  aju orgs switch acme
  aju orgs invite alex@example.com --role admin
  aju orgs members

Related:
  aju keys update        mint a local key for every org you've joined
  aju profiles use <n>   flip the active profile (and therefore which org
                         your CLI calls resolve against)
`)
}

// HelpProfiles prints the `aju profiles` subcommand overview.
func HelpProfiles() {
	fmt.Print(`aju profiles — local per-machine profiles (one key + one org each)

A profile is a (server, api-key, org) triple stored in ~/.aju/config.json.
One machine can hold many — useful when the same human belongs to multiple
shared orgs and wants 'aju search' / MCP calls routed to the right tenant.

Usage:
  aju profiles <subcommand> [flags]

Subcommands:
  list                   List all configured profiles (active marked with *)
  use <name>             Make <name> the default profile (persists across invocations)
  remove <name>          Delete a local profile. Does NOT revoke the server key.
                           --yes                skip confirmation prompt
  show                   Print the active profile's details (server, org, brain, key prefix)

Tip:
  'aju -p <name> <command>' or AJU_PROFILE=<name> overrides the default
  profile for a single invocation. Useful for flipping between orgs.

Examples:
  aju profiles list
  aju profiles use acme
  aju profiles remove stale-profile --yes
  AJU_PROFILE=work aju search "quarterly goals"
`)
}

// HelpBrains prints the `aju brains` subcommand overview.
func HelpBrains() {
	fmt.Print(`aju brains — manage brains (per-tenant memory spaces)

Usage:
  aju brains <subcommand> [flags]

Subcommands:
  list                   List brains accessible to the active profile
                         (active brain marked with *)
  create <name>          Create a brain in the active org
                           --type personal|org   (default: personal)
  delete <name>          Delete a brain. Refuses to delete your only owned brain.
                           --yes                 skip confirmation prompt
  switch <name>          Switch the active brain (writes ~/.aju/config.json)

Examples:
  aju brains list
  aju brains create "Personal"
  aju brains create "Acme" --type org
  aju brains switch Personal
  aju brains delete "stale-brain" --yes

Global flag:
  --brain <name>         target a specific brain for one call (overrides the
                         active brain stored locally)
`)
}

// HelpFiles prints the `aju files` subcommand overview.
func HelpFiles() {
	fmt.Print(`aju files — upload, list, fetch, and delete binary assets in a brain

Usage:
  aju files <subcommand> [flags]

Subcommands:
  list                          List files in the active (or --brain) brain
                                  --category <c>        filter by category
                                  --json                print raw JSON
  read <key>                    Read a file
                                  --mode metadata|url|content    (default: metadata)
                                  --output <path>       write content to file (--mode content)
                                  --json                metadata mode: print raw JSON
  upload <local-path>           Upload a local file
                                  --category <c>        file category
                                  --tags a,b,c          comma-separated tags
  delete <key>                  Delete a file
                                  --yes                 skip confirmation prompt

Examples:
  aju files list --category receipts
  aju files read img/2026/04-22.png --mode url
  aju files read img/2026/04-22.png --mode content --output /tmp/out.png
  aju files upload ./diagram.png --category diagrams --tags design,q2
  aju files delete img/2026/04-22.png --yes

Global flag (all subcommands):
  --brain <name>         target a specific brain (overrides the active brain)
`)
}

// HelpSkill prints the `aju skill` subcommand overview.
func HelpSkill() {
	fmt.Print(`aju skill — install or remove the aju skill into agent tools

A "skill" is a small packaged instruction file that teaches an AI agent how
to talk to your vault via the aju CLI. Installing copies the skill into the
target tool's configured location.

Usage:
  aju skill <subcommand> [target]

Subcommands:
  install <tool>         Install the aju skill into a target tool
  remove <tool>          Remove the installed skill from a target tool
  list                   List supported skill targets

Examples:
  aju skill list
  aju skill install claude
  aju skill remove claude
`)
}

// HelpMCP prints the `aju mcp` subcommand overview.
func HelpMCP() {
	fmt.Print(`aju mcp — run aju's Model Context Protocol server

Usage:
  aju mcp <subcommand>

Subcommands:
  serve                  Run MCP server (not implemented yet — placeholder)

Note:
  The canonical aju MCP server lives in the main repo at apps/mcp. This CLI
  subcommand is a stub reserved for a future in-process variant.
`)
}
