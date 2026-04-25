package cmd

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/tomskest/aju/cli/internal/config"
)

// RunProfiles dispatches the `aju profiles` sub-subcommands.
//
// Each profile is a (server, api-key, org) triple. One machine can hold
// many — useful when the same human belongs to multiple shared orgs and
// wants `aju search` / MCP calls routed to the right tenant database.
//
// No-arg falls back to `profiles list` — the common case for "what have I
// got configured?". Explicit `help` / `--help` / `-h` prints the help block.
func RunProfiles(args []string) error {
	if len(args) < 1 {
		return ProfilesList(nil)
	}
	if isHelpArg(args[0]) {
		HelpProfiles()
		return nil
	}
	switch args[0] {
	case "list", "ls":
		return ProfilesList(args[1:])
	case "use", "switch":
		return ProfilesUse(args[1:])
	case "remove", "rm":
		return ProfilesRemove(args[1:])
	case "show", "current":
		return ProfilesShow(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown profiles subcommand: %s\n\n", args[0])
		HelpProfiles()
		return ErrSilent
	}
}

// ProfilesList prints every configured profile, marking the active one.
func ProfilesList(args []string) error {
	fs := flag.NewFlagSet("profiles list", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary: "List configured profiles. * marks the active one.",
		Usage:   "aju profiles list",
		Long:    "Tab-separated: marker, name, org, server, sign-in state.",
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	names := cfg.ProfileNames()
	if len(names) == 0 {
		fmt.Fprintln(os.Stderr, "No profiles configured. Run `aju login` to create one.")
		return nil
	}
	for _, name := range names {
		p := cfg.Profiles[name]
		marker := " "
		if name == cfg.Active {
			marker = "*"
		}
		org := p.Org
		if org == "" {
			org = "—"
		}
		server := p.Server
		if server == "" {
			server = config.DefaultServer
		}
		keyState := "not signed in"
		if p.Key != "" {
			keyState = "signed in"
		}
		fmt.Printf("%s %s\torg=%s\tserver=%s\t%s\n", marker, name, org, server, keyState)
	}
	return nil
}

// ProfilesUse sets the default profile (persisted across invocations).
func ProfilesUse(args []string) error {
	if anyHelpArg(args) {
		fmt.Print(`Make <name> the default profile. Persisted in ~/.aju/config.json and
used by every subsequent 'aju' invocation (unless overridden with
AJU_PROFILE or --profile).

Usage:
  aju profiles use <name>

Examples:
  aju profiles use acme
  aju profiles use personal
`)
		return nil
	}
	if len(args) < 1 {
		return errors.New("usage: aju profiles use <name>")
	}
	name := strings.TrimSpace(args[0])
	if name == "" {
		return errors.New("profile name required")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if _, ok := cfg.Profiles[name]; !ok {
		names := cfg.ProfileNames()
		if len(names) == 0 {
			return fmt.Errorf("no profiles configured — run `aju login --profile %s` first", name)
		}
		return fmt.Errorf("no profile named %q (have: %s)", name, strings.Join(names, ", "))
	}
	cfg.DefaultProfile = name
	if err := config.Save(cfg); err != nil {
		return err
	}
	fmt.Printf("Default profile: %s\n", name)
	return nil
}

// ProfilesRemove deletes a profile. Refuses to delete the active one; the
// user must switch first to avoid a self-foot-gun.
func ProfilesRemove(args []string) error {
	fs := flag.NewFlagSet("profiles remove", flag.ContinueOnError)
	yes := fs.Bool("yes", false, "skip the interactive confirmation")
	setLeafUsage(fs, leafHelp{
		Summary: "Delete a local profile. Does NOT revoke the server-side API key.",
		Usage:   "aju profiles remove <name> [--yes]",
		Long:    "To also revoke the key, run 'aju keys revoke <prefix>' separately.",
		Examples: []string{
			"aju profiles remove stale-profile",
			"aju profiles remove stale-profile --yes",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju profiles remove <name> [--yes]")
	}
	name := strings.TrimSpace(fs.Arg(0))
	if name == "" {
		return errors.New("profile name required")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if _, ok := cfg.Profiles[name]; !ok {
		return fmt.Errorf("no profile named %q", name)
	}
	if !*yes {
		fmt.Printf("Remove profile %s? This does NOT revoke the API key on the server — run `aju keys revoke` for that. [y/N] ", name)
		var answer string
		_, _ = fmt.Scanln(&answer)
		if strings.ToLower(strings.TrimSpace(answer)) != "y" &&
			strings.ToLower(strings.TrimSpace(answer)) != "yes" {
			fmt.Println("Cancelled.")
			return nil
		}
	}
	if err := cfg.RemoveProfile(name); err != nil {
		return err
	}
	if err := config.Save(cfg); err != nil {
		return err
	}
	fmt.Printf("Removed profile %s.\n", name)
	return nil
}

// ProfilesShow prints details about the active profile.
func ProfilesShow(args []string) error {
	fs := flag.NewFlagSet("profiles show", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary: "Print the active profile's details: server, org, brain, masked key.",
		Usage:   "aju profiles show",
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if _, ok := cfg.Profiles[cfg.Active]; !ok {
		fmt.Fprintln(os.Stderr, "No active profile. Run `aju login` to create one.")
		return nil
	}
	p := cfg.Profile()
	server := p.Server
	if server == "" {
		server = config.DefaultServer
	}
	fmt.Printf("Active profile: %s\n", cfg.Active)
	fmt.Printf("  server:    %s\n", server)
	fmt.Printf("  org:       %s\n", nonEmpty(p.Org, "—"))
	fmt.Printf("  brain:     %s\n", nonEmpty(p.Brain, "—"))
	if p.Key != "" {
		fmt.Printf("  api key:   %s…%s (hidden)\n", safePrefix(p.Key), safeSuffix(p.Key))
	} else {
		fmt.Println("  api key:   (not signed in)")
	}
	return nil
}

func nonEmpty(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}

func safePrefix(k string) string {
	if len(k) <= 12 {
		return k
	}
	return k[:12]
}

func safeSuffix(k string) string {
	if len(k) <= 4 {
		return ""
	}
	return k[len(k)-4:]
}
