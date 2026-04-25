package cmd

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

// agentKeySummary mirrors a single entry in GET /api/agents/:id/keys.
type agentKeySummary struct {
	ID             string   `json:"id"`
	Prefix         string   `json:"prefix"`
	Name           string   `json:"name"`
	Scopes         []string `json:"scopes"`
	CreatedAt      string   `json:"createdAt"`
	LastUsedAt     string   `json:"lastUsedAt"`
	ExpiresAt      string   `json:"expiresAt"`
	RevokedAt      string   `json:"revokedAt"`
	MintedByUserID string   `json:"mintedByUserId"`
}

type agentKeysListResp struct {
	Keys []agentKeySummary `json:"keys"`
}

type agentKeyCreateReq struct {
	Name          string   `json:"name"`
	Scopes        []string `json:"scopes,omitempty"`
	ExpiresInDays *int     `json:"expiresInDays,omitempty"`
}

type agentKeyCreateResp struct {
	Key struct {
		ID        string   `json:"id"`
		Prefix    string   `json:"prefix"`
		Name      string   `json:"name"`
		Scopes    []string `json:"scopes"`
		CreatedAt string   `json:"createdAt"`
		ExpiresAt string   `json:"expiresAt"`
		AgentID   string   `json:"agentId"`
	} `json:"key"`
	Plaintext string `json:"plaintext"`
	Warning   string `json:"warning"`
}

// RunAgentKeys dispatches `aju agents keys <sub>`.
func RunAgentKeys(args []string) error {
	if len(args) < 1 || isHelpArg(args[0]) {
		HelpAgentKeys()
		if len(args) < 1 {
			return ErrSilent
		}
		return nil
	}
	switch args[0] {
	case "list":
		return AgentKeysList(args[1:])
	case "create":
		return AgentKeysCreate(args[1:])
	case "revoke":
		return AgentKeysRevoke(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown agents keys subcommand: %s\n\n", args[0])
		HelpAgentKeys()
		return ErrSilent
	}
}

// AgentKeysList prints the API keys that authenticate as the given agent.
// Usage: aju agents keys list <agent-id>
func AgentKeysList(args []string) error {
	fs := flag.NewFlagSet("agents keys list", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary:  "List API keys that authenticate as a given agent.",
		Usage:    "aju agents keys list <agent-id>",
		Examples: []string{"aju agents keys list agt_01HX..."},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju agents keys list <agent-id>")
	}
	agentID := strings.TrimSpace(fs.Arg(0))
	if agentID == "" {
		return errors.New("agent id required")
	}

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var resp agentKeysListResp
	if err := client.Get("/api/agents/"+agentID+"/keys", &resp); err != nil {
		return printFriendlyErr(err)
	}
	if len(resp.Keys) == 0 {
		fmt.Fprintf(os.Stderr, "No keys for agent %s. Run `aju agents keys create %s <name>` to mint one.\n", agentID, agentID)
		return nil
	}
	for _, k := range resp.Keys {
		fmt.Printf(
			"%s\t%s\t%s\t%s\t%s\n",
			k.Prefix,
			k.Name,
			strings.Join(k.Scopes, ","),
			formatLastUsed(k.LastUsedAt),
			agentKeyStatus(k),
		)
	}
	return nil
}

// AgentKeysCreate mints a new key that authenticates as the given agent.
// Usage: aju agents keys create <agent-id> <name> [--scopes read,write] [--expires-days 90]
func AgentKeysCreate(args []string) error {
	fs := flag.NewFlagSet("agents keys create", flag.ContinueOnError)
	scopesFlag := fs.String("scopes", "read,write", "comma-separated scopes: read, write, admin")
	expiresDays := fs.Int("expires-days", 0, "days until the key expires (0 = no expiry)")
	setLeafUsage(fs, leafHelp{
		Summary: "Mint a key that authenticates as the given agent.",
		Usage:   "aju agents keys create <agent-id> <name> [--scopes read,write] [--expires-days 90]",
		Long: `The plaintext key is printed ONCE in this call's output. Save it — the
server never reveals it again. The key inherits the agent's brain grants,
not the caller's memberships.`,
		Examples: []string{
			"aju agents keys create agt_01HX... laptop",
			"aju agents keys create agt_01HX... ci-runner --scopes read --expires-days 30",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 2 {
		return errors.New("usage: aju agents keys create <agent-id> <name> [--scopes read,write] [--expires-days 90]")
	}
	agentID := strings.TrimSpace(fs.Arg(0))
	name := strings.TrimSpace(fs.Arg(1))
	if agentID == "" {
		return errors.New("agent id required")
	}
	if name == "" {
		return errors.New("name required")
	}

	scopes := parseScopesFlag(*scopesFlag)
	if len(scopes) == 0 {
		return errors.New("at least one scope is required (read, write, or admin)")
	}

	body := agentKeyCreateReq{Name: name, Scopes: scopes}
	if *expiresDays > 0 {
		d := *expiresDays
		body.ExpiresInDays = &d
	}

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var resp agentKeyCreateResp
	if err := client.Post("/api/agents/"+agentID+"/keys", body, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if resp.Plaintext == "" {
		return fmt.Errorf("server returned empty plaintext")
	}

	fmt.Println()
	fmt.Println("================================================================")
	fmt.Println("  New agent API key — copy this now, it will not be shown again:")
	fmt.Println("================================================================")
	fmt.Println()
	fmt.Printf("  %s\n", resp.Plaintext)
	fmt.Println()
	fmt.Println("----------------------------------------------------------------")
	fmt.Printf("  prefix:  %s\n", resp.Key.Prefix)
	fmt.Printf("  name:    %s\n", resp.Key.Name)
	fmt.Printf("  scopes:  %s\n", strings.Join(resp.Key.Scopes, ","))
	fmt.Printf("  agent:   %s\n", resp.Key.AgentID)
	if resp.Key.ExpiresAt != "" {
		fmt.Printf("  expires: %s\n", shortDate(resp.Key.ExpiresAt))
	} else {
		fmt.Println("  expires: never")
	}
	fmt.Println("----------------------------------------------------------------")
	if resp.Warning != "" {
		fmt.Println(resp.Warning)
	} else {
		fmt.Println("Save this key somewhere safe. If lost, revoke and create a new one.")
	}
	return nil
}

// AgentKeysRevoke revokes an agent key by id or prefix. Resolves against the
// agent's own key list so accidental revocations of a user key are impossible.
// Usage: aju agents keys revoke <agent-id> <id-or-prefix> [--yes]
func AgentKeysRevoke(args []string) error {
	fs := flag.NewFlagSet("agents keys revoke", flag.ContinueOnError)
	yes := fs.Bool("yes", false, "skip the interactive confirmation")
	setLeafUsage(fs, leafHelp{
		Summary: "Revoke an agent key by id or prefix.",
		Usage:   "aju agents keys revoke <agent-id> <id-or-prefix> [--yes]",
		Long:    "Resolves the target against the agent's own key list, so revoking a user key through this command is impossible.",
		Examples: []string{
			"aju agents keys revoke agt_01HX... ak_live_12",
			"aju agents keys revoke agt_01HX... ak_live_12 --yes",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 2 {
		return errors.New("usage: aju agents keys revoke <agent-id> <id-or-prefix> [--yes]")
	}
	agentID := strings.TrimSpace(fs.Arg(0))
	target := strings.TrimSpace(fs.Arg(1))

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var list agentKeysListResp
	if err := client.Get("/api/agents/"+agentID+"/keys", &list); err != nil {
		return printFriendlyErr(err)
	}

	// Reuse the key resolver over a narrow list (this agent's keys only).
	summaries := make([]keySummary, 0, len(list.Keys))
	for _, k := range list.Keys {
		summaries = append(summaries, keySummary{
			ID:         k.ID,
			Prefix:     k.Prefix,
			Name:       k.Name,
			Scopes:     k.Scopes,
			CreatedAt:  k.CreatedAt,
			LastUsedAt: k.LastUsedAt,
			ExpiresAt:  k.ExpiresAt,
			RevokedAt:  k.RevokedAt,
		})
	}
	resolved, err := resolveKey(summaries, target)
	if err != nil {
		return err
	}
	if resolved.RevokedAt != "" {
		fmt.Printf("Already revoked: %s (%s)\n", resolved.Prefix, resolved.Name)
		return nil
	}

	if !*yes {
		fmt.Printf("Revoke agent key %s (%s)? [y/N] ", resolved.Prefix, resolved.Name)
		var answer string
		fmt.Scanln(&answer)
		if a := strings.ToLower(strings.TrimSpace(answer)); a != "y" && a != "yes" {
			fmt.Println("Cancelled.")
			return nil
		}
	}

	if err := client.Do("DELETE", "/api/keys/"+resolved.ID, nil, nil); err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf("Revoked %s (%s)\n", resolved.Prefix, resolved.Name)
	return nil
}

// agentKeyStatus returns "active" | "revoked" | "expired".
func agentKeyStatus(k agentKeySummary) string {
	if k.RevokedAt != "" {
		return "revoked"
	}
	if k.ExpiresAt != "" {
		if t, err := time.Parse(time.RFC3339, k.ExpiresAt); err == nil {
			if !t.After(time.Now()) {
				return "expired"
			}
		}
	}
	return "active"
}
