package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/tomskest/aju/cli/cmd"
	"github.com/tomskest/aju/cli/internal/httpx"
)

// Version is the CLI version string. Overridden at build time via
// -ldflags "-X main.Version=..." by the release workflow.
var Version = "0.1.0-dev"

func init() {
	// Stamp the version into the HTTP client's User-Agent hint header and
	// the cmd package's manifest-compare constant.
	httpx.Version = Version
	cmd.CurrentVersion = Version
}

func main() {
	if len(os.Args) < 2 {
		cmd.Help()
		os.Exit(1)
	}

	// Peel off a top-level `--profile <name>` / `-p <name>` before dispatch.
	// Setting AJU_PROFILE this way means downstream `config.Load()` calls
	// pick the right profile without every subcommand having to know the
	// flag exists. Scans only the leading args so `aju search "-p"` still
	// passes `-p` through to the search command.
	args := extractProfileFlag(os.Args[1:])
	if len(args) < 1 {
		cmd.Help()
		os.Exit(1)
	}

	first := args[0]
	rest := args[1:]

	// Best-effort pre-dispatch manifest check. Never blocks; may hard-stop
	// the CLI only if the current version is below min_supported.
	if err := cmd.PreDispatch(first); errors.Is(err, cmd.ErrOutdatedUnsupported) {
		os.Exit(1)
	}

	switch first {
	case "version", "--version", "-v":
		fmt.Println(Version)
		return
	case "help", "--help", "-h":
		cmd.Help()
		return
	case "login":
		exitWith(cmd.Login(rest))
	case "agent-provision":
		exitWith(cmd.AgentProvision(rest))
	case "logout":
		exitWith(cmd.Logout(rest))
	case "status":
		exitWith(cmd.Status(rest))
	case "whoami":
		exitWith(cmd.Whoami(rest))
	case "skill":
		exitWith(dispatchSkill(rest))
	case "brains":
		exitWith(dispatchBrains(rest))
	case "orgs":
		exitWith(cmd.RunOrgs(rest))
	case "agents":
		exitWith(cmd.RunAgents(rest))
	case "keys":
		exitWith(cmd.RunKeys(rest))
	case "profiles":
		exitWith(cmd.RunProfiles(rest))
	case "files":
		exitWith(dispatchFiles(rest))
	case "export":
		exitWith(cmd.Export(rest))
	case "mcp":
		exitWith(dispatchMCP(rest))
	case "search":
		exitWith(cmd.Search(rest))
	case "semantic":
		exitWith(cmd.Semantic(rest))
	case "deep-search":
		exitWith(cmd.DeepSearch(rest))
	case "read":
		exitWith(cmd.Read(rest))
	case "browse":
		exitWith(cmd.Browse(rest))
	case "create":
		exitWith(cmd.Create(rest))
	case "update":
		// No args or flag-only → self-update. A positional arg → note update.
		if isSelfUpdateInvocation(rest) {
			exitWith(cmd.UpdateSelf(rest))
		} else {
			exitWith(cmd.UpdateNote(rest))
		}
	case "delete":
		exitWith(cmd.Delete(rest))
	case "backlinks":
		exitWith(cmd.Backlinks(rest))
	case "related":
		exitWith(cmd.Related(rest))
	case "graph":
		exitWith(cmd.Graph(rest))
	case "rebuild-links":
		exitWith(cmd.RebuildLinks(rest))
	case "reindex":
		exitWith(cmd.Reindex(rest))
	case "changes":
		exitWith(cmd.Changes(rest))
	case "news":
		exitWith(cmd.News(rest))
	case "doctor":
		exitWith(cmd.Doctor(rest))
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n\n", first)
		cmd.Help()
		os.Exit(1)
	}
}

func dispatchSkill(args []string) error {
	if len(args) < 1 || isHelpArg(args[0]) {
		cmd.HelpSkill()
		if len(args) < 1 {
			return cmd.ErrSilent
		}
		return nil
	}
	switch args[0] {
	case "install":
		return cmd.SkillInstall(args[1:])
	case "remove":
		return cmd.SkillRemove(args[1:])
	case "list", "ls":
		return cmd.SkillList(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown skill subcommand: %s\n\n", args[0])
		cmd.HelpSkill()
		return cmd.ErrSilent
	}
}

func dispatchBrains(args []string) error {
	if len(args) < 1 || isHelpArg(args[0]) {
		cmd.HelpBrains()
		if len(args) < 1 {
			return cmd.ErrSilent
		}
		return nil
	}
	switch args[0] {
	case "list":
		return cmd.BrainsList(args[1:])
	case "create":
		return cmd.BrainsCreate(args[1:])
	case "delete":
		return cmd.BrainsDelete(args[1:])
	case "switch":
		return cmd.BrainsSwitch(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown brains subcommand: %s\n\n", args[0])
		cmd.HelpBrains()
		return cmd.ErrSilent
	}
}

func dispatchFiles(args []string) error {
	if len(args) < 1 || isHelpArg(args[0]) {
		cmd.HelpFiles()
		if len(args) < 1 {
			return cmd.ErrSilent
		}
		return nil
	}
	switch args[0] {
	case "list":
		return cmd.FilesList(args[1:])
	case "read":
		return cmd.FilesRead(args[1:])
	case "upload":
		return cmd.FilesUpload(args[1:])
	case "delete":
		return cmd.FilesDelete(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown files subcommand: %s\n\n", args[0])
		cmd.HelpFiles()
		return cmd.ErrSilent
	}
}

func dispatchMCP(args []string) error {
	if len(args) < 1 || isHelpArg(args[0]) {
		cmd.HelpMCP()
		if len(args) < 1 {
			return cmd.ErrSilent
		}
		return nil
	}
	switch args[0] {
	case "serve":
		return cmd.StubMCPServe(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown mcp subcommand: %s\n\n", args[0])
		cmd.HelpMCP()
		return cmd.ErrSilent
	}
}

// isHelpArg mirrors cmd.isHelpArg — duplicated here to keep main.go free of
// an import dance for a tiny string-compare helper.
func isHelpArg(s string) bool {
	return s == "help" || s == "--help" || s == "-h" || s == "-help"
}

// isSelfUpdateInvocation reports whether `aju update <args>` should dispatch
// to the self-update handler (no positional path arg) rather than note
// update. Flags are transparent — only a positional (non-flag) argument
// implies the note path form.
func isSelfUpdateInvocation(args []string) bool {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if len(a) > 0 && a[0] == '-' {
			// Flag. Skip a value if the flag uses the "--k v" form;
			// known flag with value: --install-base.
			if a == "--install-base" || a == "-install-base" {
				i++
			}
			continue
		}
		// A positional argument — treat as the note path form.
		return false
	}
	return true
}

func exitWith(err error) {
	if err == nil || errors.Is(err, cmd.ErrHelpHandled) {
		return
	}
	if !errors.Is(err, cmd.ErrSilent) {
		fmt.Fprintln(os.Stderr, err)
	}
	os.Exit(1)
}

// extractProfileFlag scans the leading args for `-p <name>` or
// `--profile <name>` (also `--profile=<name>` / `-p=<name>`), removes them
// from the returned slice, and exports AJU_PROFILE so config.Load picks the
// right profile. Returns the remaining args for normal dispatch.
//
// Only leading flags are considered — once we hit a non-flag token (the
// command name), scanning stops. This preserves the ability to pass `-p`
// as a real argument to downstream subcommands.
func extractProfileFlag(in []string) []string {
	out := make([]string, 0, len(in))
	i := 0
	for i < len(in) {
		a := in[i]
		if !isLeadingProfileFlag(a) {
			out = append(out, in[i:]...)
			return out
		}
		// Forms: `--profile=foo`, `-p=foo` (single token) vs `--profile foo`
		if eq := indexOf(a, '='); eq > 0 {
			setProfileEnv(a[eq+1:])
			i++
			continue
		}
		if i+1 >= len(in) {
			fmt.Fprintln(os.Stderr, "missing value for --profile")
			os.Exit(1)
		}
		setProfileEnv(in[i+1])
		i += 2
	}
	return out
}

func isLeadingProfileFlag(a string) bool {
	return a == "-p" || a == "--profile" ||
		hasPrefix(a, "-p=") || hasPrefix(a, "--profile=")
}

func setProfileEnv(v string) {
	if v == "" {
		return
	}
	_ = os.Setenv("AJU_PROFILE", v)
}

func hasPrefix(s, p string) bool {
	if len(s) < len(p) {
		return false
	}
	return s[:len(p)] == p
}

func indexOf(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}
