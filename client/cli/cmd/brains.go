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

type brainMember struct {
	AccessID  string `json:"accessId"`
	UserID    string `json:"userId"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	GrantedAt string `json:"grantedAt"`
}

type brainMembersResp struct {
	Brain struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Type string `json:"type"`
	} `json:"brain"`
	Members []brainMember `json:"members"`
}

// resolveBrainID looks up a brain id by name from the listing endpoint.
// Returns a friendly error if the brain isn't visible to the caller.
func resolveBrainID(client *httpx.Client, name string) (string, error) {
	var list brainsListResp
	if err := client.Get("/api/brains", &list); err != nil {
		return "", printFriendlyErr(err)
	}
	id := findBrainIDByName(list.Brains, name)
	if id == "" {
		return "", fmt.Errorf("no brain named %q", name)
	}
	return id, nil
}

// BrainsShare grants a user explicit access to a brain.
func BrainsShare(args []string) error {
	fs := flag.NewFlagSet("brains share", flag.ContinueOnError)
	role := fs.String("role", "editor", "role to grant: viewer | editor | owner")
	setLeafUsage(fs, leafHelp{
		Summary: "Grant a user access to a brain.",
		Usage:   "aju brains share <name> <email> [--role viewer|editor|owner]",
		Long: `Adds (or updates) a user's BrainAccess row on this brain. The target user
must already be a member of the brain's organization. Owner-only.

For org brains, every org member already has editor access through membership;
sharing only matters when you want to promote someone to owner or override
their role for that brain. For personal brains, sharing is the only way to
grant access without making the brain org-wide.`,
		Examples: []string{
			"aju brains share my-notes teammate@example.com",
			"aju brains share my-notes teammate@example.com --role viewer",
			"aju brains share research lead@example.com --role owner",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 2 {
		return errors.New("usage: aju brains share <name> <email> [--role viewer|editor|owner]")
	}
	name := fs.Arg(0)
	email := fs.Arg(1)

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}
	id, err := resolveBrainID(client, name)
	if err != nil {
		return err
	}

	body := map[string]any{"email": email, "role": *role}
	var resp struct {
		OK      bool `json:"ok"`
		Updated bool `json:"updated"`
		Grant   struct {
			Role string `json:"role"`
		} `json:"grant"`
	}
	if err := client.Post("/api/brains/"+id+"/access", body, &resp); err != nil {
		return printFriendlyErr(err)
	}
	verb := "Granted"
	if resp.Updated {
		verb = "Updated"
	}
	fmt.Printf("%s %s as %s on %s\n", verb, email, resp.Grant.Role, name)
	return nil
}

// BrainsUnshare revokes a user's access to a brain.
func BrainsUnshare(args []string) error {
	fs := flag.NewFlagSet("brains unshare", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary: "Revoke a user's access to a brain.",
		Usage:   "aju brains unshare <name> <email>",
		Long: `Removes the user's explicit BrainAccess row. For org brains, the user may
still have implicit editor access via org membership — that's gated at the
org level, not per-brain. Refuses to remove the last owner. Owner-only.`,
		Examples: []string{
			"aju brains unshare my-notes teammate@example.com",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 2 {
		return errors.New("usage: aju brains unshare <name> <email>")
	}
	name := fs.Arg(0)
	email := fs.Arg(1)

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}
	id, err := resolveBrainID(client, name)
	if err != nil {
		return err
	}

	// Look up userId by listing members — the DELETE route is keyed by userId,
	// not email, since email is mutable in the control DB.
	var members brainMembersResp
	if err := client.Get("/api/brains/"+id+"/access", &members); err != nil {
		return printFriendlyErr(err)
	}
	target := ""
	for _, m := range members.Members {
		if strings.EqualFold(m.Email, email) {
			target = m.UserID
			break
		}
	}
	if target == "" {
		return fmt.Errorf("%s has no explicit access to %s", email, name)
	}

	if err := client.Do("DELETE", "/api/brains/"+id+"/access/"+target, nil, nil); err != nil {
		if he := asHTTPError(err); he != nil && he.Status == 409 &&
			strings.Contains(he.Body, "cannot_remove_last_owner") {
			fmt.Fprintln(os.Stderr,
				"Refused: this is the last owner — promote someone else to owner first.")
			return ErrSilent
		}
		return printFriendlyErr(err)
	}
	fmt.Printf("Revoked %s from %s\n", email, name)
	return nil
}

// BrainsMembers prints the user-backed BrainAccess rows for a brain.
func BrainsMembers(args []string) error {
	fs := flag.NewFlagSet("brains members", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary: "List explicit members of a brain.",
		Usage:   "aju brains members <name>",
		Long: `Shows users with explicit BrainAccess rows on this brain (one row per role).
Agent grants surface via 'aju agents show' instead. Org-level membership-
based access does NOT appear here — those are implicit, not per-brain rows.
Owner-only.`,
		Examples: []string{"aju brains members my-notes"},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju brains members <name>")
	}
	name := fs.Arg(0)

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}
	id, err := resolveBrainID(client, name)
	if err != nil {
		return err
	}

	var resp brainMembersResp
	if err := client.Get("/api/brains/"+id+"/access", &resp); err != nil {
		return printFriendlyErr(err)
	}
	if len(resp.Members) == 0 {
		fmt.Fprintln(os.Stderr, "No explicit members.")
		return nil
	}
	for _, m := range resp.Members {
		fmt.Printf("%s\t%s\t%s\n", m.Email, m.Role, m.Name)
	}
	return nil
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
