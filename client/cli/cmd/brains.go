package cmd

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/tomskest/aju/client/cli/internal/config"
	"github.com/tomskest/aju/client/cli/internal/httpx"
)

// brainSummary mirrors one entry in GET /api/brains.
type brainSummary struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Type          string `json:"type"`
	DocumentCount int    `json:"documentCount"`
	Role          string `json:"role"`
	CreatedAt     string `json:"createdAt"`
}

type brainsListResp struct {
	Brains []brainSummary `json:"brains"`
}

type brainCreated struct {
	Brain struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Type string `json:"type"`
	} `json:"brain"`
}

// httpError lets us peek at the server-side status + body so CLI handlers can
// special-case errors like 409 last_brain. Falls back to nil when the wrapped
// error isn't an httpx.Error.
func asHTTPError(err error) *httpx.Error {
	var e *httpx.Error
	if errors.As(err, &e) {
		return e
	}
	return nil
}

// BrainsList prints every brain the caller can access, marking the active
// brain (via config.Brain) with a "*". Output is tab-separated to stay friendly
// to downstream shell tools.
func BrainsList(args []string) error {
	fs := flag.NewFlagSet("brains list", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary:  "List brains accessible to the active profile. Active brain marked with *.",
		Usage:    "aju brains list",
		Examples: []string{"aju brains list"},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var resp brainsListResp
	if err := client.Get("/api/brains", &resp); err != nil {
		return printFriendlyErr(err)
	}

	if len(resp.Brains) == 0 {
		fmt.Fprintln(os.Stderr, "No brains.")
		return nil
	}

	active := cfg.Profile().Brain
	for _, b := range resp.Brains {
		marker := " "
		if active != "" && b.Name == active {
			marker = "*"
		}
		fmt.Printf("%s\t%s\t%s\t%s\t%d\n", marker, b.Name, b.Type, b.Role, b.DocumentCount)
	}
	return nil
}

// BrainsCreate provisions a brain named <name> in the caller's active org.
func BrainsCreate(args []string) error {
	fs := flag.NewFlagSet("brains create", flag.ContinueOnError)
	brainType := fs.String("type", "", "brain type (default: personal)")
	setLeafUsage(fs, leafHelp{
		Summary: "Create a brain in the active organization.",
		Usage:   "aju brains create <name> [--type personal|org]",
		Long: `Personal brains are visible only to their owner; org brains are visible
to every member of the org.`,
		Examples: []string{
			"aju brains create Personal",
			"aju brains create Acme --type org",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju brains create <name> [--type personal|org]")
	}
	name := fs.Arg(0)

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	body := map[string]any{"name": name}
	if *brainType != "" {
		body["type"] = *brainType
	}

	var resp brainCreated
	if err := client.Post("/api/brains", body, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if resp.Brain.ID == "" {
		return fmt.Errorf("server returned empty brain id")
	}
	fmt.Printf("Created brain: %s (id %s)\n", resp.Brain.Name, resp.Brain.ID)
	return nil
}

// BrainsDelete removes a brain by name. Confirms destructively unless --yes
// is passed, and surfaces the 409 last_brain error in a friendly form.
func BrainsDelete(args []string) error {
	fs := flag.NewFlagSet("brains delete", flag.ContinueOnError)
	yes := fs.Bool("yes", false, "skip confirmation prompt")
	setLeafUsage(fs, leafHelp{
		Summary: "Delete a brain by name. Destructive — refuses to delete your only owned brain.",
		Usage:   "aju brains delete <name> [--yes]",
		Long:    "Without --yes, the command requires the brain name to be retyped before proceeding.",
		Examples: []string{
			"aju brains delete stale-brain",
			"aju brains delete stale-brain --yes",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju brains delete <name> [--yes]")
	}
	name := fs.Arg(0)

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var list brainsListResp
	if err := client.Get("/api/brains", &list); err != nil {
		return printFriendlyErr(err)
	}
	id := findBrainIDByName(list.Brains, name)
	if id == "" {
		return fmt.Errorf("no brain named %q", name)
	}

	if !*yes {
		confirmed, err := confirmDeletion(name)
		if err != nil {
			return err
		}
		if !confirmed {
			fmt.Println("Aborted.")
			return nil
		}
	}

	if err := client.Do("DELETE", "/api/brains/"+id, nil, nil); err != nil {
		if he := asHTTPError(err); he != nil && he.Status == 409 &&
			strings.Contains(he.Body, "last_brain") {
			fmt.Fprintln(os.Stderr,
				"Can't delete your only owned brain — create another brain first.")
			return ErrSilent
		}
		return printFriendlyErr(err)
	}
	fmt.Printf("Deleted brain: %s\n", name)
	return nil
}

// BrainsSwitch updates config.Brain. No server call — the server resolves the
// brain on each request from the ?brain=<name> query parameter.
func BrainsSwitch(args []string) error {
	if anyHelpArg(args) {
		fmt.Print(`Switch the active brain for the current profile. Purely local — writes
~/.aju/config.json. The server resolves the brain on each request from the
?brain=<name> query parameter.

Usage:
  aju brains switch <name>

Examples:
  aju brains switch Personal
  aju brains switch Acme
`)
		return nil
	}
	if len(args) < 1 {
		return errors.New("usage: aju brains switch <name>")
	}
	name := args[0]
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cfg.Profile().Brain = name
	if err := config.Save(cfg); err != nil {
		return err
	}
	fmt.Printf("Switched active brain to %s\n", name)
	return nil
}

// findBrainIDByName does a linear scan — brain lists are short, so a map is
// overkill.
func findBrainIDByName(brains []brainSummary, name string) string {
	for _, b := range brains {
		if b.Name == name {
			return b.ID
		}
	}
	return ""
}

// confirmDeletion asks the user to type the brain name before proceeding.
// Input is read from stdin; EOF on a pipe counts as "not confirmed".
func confirmDeletion(name string) (bool, error) {
	fmt.Fprintf(os.Stderr, "Type %q to confirm deletion: ", name)
	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')
	if err != nil {
		// Treat EOF (piped with no data) as a decline rather than an error so
		// the caller sees "Aborted." and a clean exit code.
		if errors.Is(err, os.ErrClosed) || err.Error() == "EOF" {
			return false, nil
		}
		return false, err
	}
	return strings.TrimSpace(line) == name, nil
}
