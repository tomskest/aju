package cmd

import (
	"errors"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"
)

// agentSummary mirrors a single entry in GET /api/agents.
type agentSummary struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	Description      string    `json:"description"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"createdAt"`
	BrainAccessCount int       `json:"brainAccessCount"`
}

type agentsListResp struct {
	Agents []agentSummary `json:"agents"`
}

// agentDetail mirrors the nested `agent` object in GET /api/agents/:id.
type agentDetail struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	Status          string    `json:"status"`
	CreatedByUserID string    `json:"createdByUserId"`
	CreatedAt       time.Time `json:"createdAt"`
}

type agentBrainGrant struct {
	AccessID  string    `json:"accessId"`
	BrainID   string    `json:"brainId"`
	BrainName string    `json:"brainName"`
	BrainType string    `json:"brainType"`
	Role      string    `json:"role"`
	GrantedAt time.Time `json:"grantedAt"`
}

type agentDetailResp struct {
	Agent  agentDetail       `json:"agent"`
	Brains []agentBrainGrant `json:"brains"`
}

type agentCreateResp struct {
	Agent agentSummary `json:"agent"`
}

type agentActivityEntry struct {
	ID         string    `json:"id"`
	BrainID    string    `json:"brainId"`
	DocumentID string    `json:"documentId"`
	Path       string    `json:"path"`
	Operation  string    `json:"operation"`
	Source     string    `json:"source"`
	CreatedAt  time.Time `json:"createdAt"`
}

type agentActivityResp struct {
	Entries    []agentActivityEntry `json:"entries"`
	NextCursor string               `json:"nextCursor"`
}

// RunAgents dispatches `aju agents <sub>`.
func RunAgents(args []string) error {
	if len(args) < 1 || isHelpArg(args[0]) {
		HelpAgents()
		if len(args) < 1 {
			return ErrSilent
		}
		return nil
	}
	switch args[0] {
	case "list":
		return AgentsList(args[1:])
	case "create":
		return AgentsCreate(args[1:])
	case "show":
		return AgentsShow(args[1:])
	case "pause":
		return AgentsPause(args[1:])
	case "resume":
		return AgentsResume(args[1:])
	case "revoke":
		return AgentsRevoke(args[1:])
	case "grant":
		return AgentsGrant(args[1:])
	case "activity":
		return AgentsActivity(args[1:])
	case "keys":
		return RunAgentKeys(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown agents subcommand: %s\n\n", args[0])
		HelpAgents()
		return ErrSilent
	}
}

// AgentsList prints every agent in the active org.
func AgentsList(args []string) error {
	fs := flag.NewFlagSet("agents list", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary:  "List agents in the active organization.",
		Usage:    "aju agents list",
		Examples: []string{"aju agents list"},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var resp agentsListResp
	if err := client.Get("/api/agents", &resp); err != nil {
		return printFriendlyErr(err)
	}

	if len(resp.Agents) == 0 {
		fmt.Fprintln(os.Stderr, "No agents.")
		return nil
	}
	for _, a := range resp.Agents {
		fmt.Printf("%s\t%s\t%s\t%d\t%s\n",
			a.ID, a.Status, a.Name, a.BrainAccessCount, shortDate(a.CreatedAt.Format(time.RFC3339)))
	}
	return nil
}

// AgentsCreate provisions a new agent in the active org.
func AgentsCreate(args []string) error {
	fs := flag.NewFlagSet("agents create", flag.ContinueOnError)
	description := fs.String("description", "", "optional agent description")
	setLeafUsage(fs, leafHelp{
		Summary: "Create a new agent in the active organization.",
		Usage:   "aju agents create <name> [--description \"...\"]",
		Long: `Creates the agent metadata only. After creating, use 'aju agents grant'
to give the agent brain access and 'aju agents keys create' (or
'aju agent-provision') to mint an API key for it.`,
		Examples: []string{
			"aju agents create openclaw --description \"Claude desktop on my laptop\"",
			"aju agents create ci-bot",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju agents create <name> [--description \"...\"]")
	}
	name := fs.Arg(0)

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	body := map[string]any{"name": name}
	if *description != "" {
		body["description"] = *description
	}

	var resp agentCreateResp
	if err := client.Post("/api/agents", body, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if resp.Agent.ID == "" {
		return fmt.Errorf("server returned empty agent id")
	}
	fmt.Printf("Created %s (%s)\n", resp.Agent.Name, resp.Agent.ID)
	return nil
}

// AgentsShow prints an agent's detail plus its brain grants.
func AgentsShow(args []string) error {
	fs := flag.NewFlagSet("agents show", flag.ContinueOnError)
	setLeafUsage(fs, leafHelp{
		Summary:  "Show agent detail (name, status, created) and all brain grants.",
		Usage:    "aju agents show <agent-id>",
		Examples: []string{"aju agents show agt_01HX..."},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju agents show <id>")
	}
	id := fs.Arg(0)

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	var resp agentDetailResp
	if err := client.Get("/api/agents/"+url.PathEscape(id), &resp); err != nil {
		return printFriendlyErr(err)
	}

	fmt.Printf("id:          %s\n", resp.Agent.ID)
	fmt.Printf("name:        %s\n", resp.Agent.Name)
	fmt.Printf("status:      %s\n", resp.Agent.Status)
	if resp.Agent.Description != "" {
		fmt.Printf("description: %s\n", resp.Agent.Description)
	}
	fmt.Printf("created:     %s\n", shortDate(resp.Agent.CreatedAt.Format(time.RFC3339)))
	fmt.Println()
	fmt.Printf("brains (%d):\n", len(resp.Brains))
	if len(resp.Brains) == 0 {
		fmt.Println("  (none)")
	}
	for _, b := range resp.Brains {
		fmt.Printf("  %s\t%s\t%s\t(granted %s)\n",
			b.BrainName, b.BrainType, b.Role, shortDate(b.GrantedAt.Format(time.RFC3339)))
	}
	return nil
}

// AgentsPause flips an agent's status to paused.
func AgentsPause(args []string) error {
	return patchAgentStatus(args, "paused")
}

// AgentsResume flips a paused agent back to active.
func AgentsResume(args []string) error {
	return patchAgentStatus(args, "active")
}

// patchAgentStatus is the shared body for pause/resume.
func patchAgentStatus(args []string, status string) error {
	verb := map[string]string{"paused": "pause", "active": "resume"}[status]
	fsName := fmt.Sprintf("agents %s", verb)
	fs := flag.NewFlagSet(fsName, flag.ContinueOnError)
	if status == "paused" {
		setLeafUsage(fs, leafHelp{
			Summary: "Pause an active agent. Its keys keep existing but stop working.",
			Usage:   "aju agents pause <agent-id>",
			Long:    "Reversible — run 'aju agents resume <id>' to re-enable.",
		})
	} else {
		setLeafUsage(fs, leafHelp{
			Summary: "Resume a paused agent. Existing keys start working again.",
			Usage:   "aju agents resume <agent-id>",
		})
	}
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return fmt.Errorf("usage: aju agents %s <id>", verb)
	}
	id := fs.Arg(0)

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	body := map[string]any{"status": status}
	if err := client.Do(http.MethodPatch, "/api/agents/"+url.PathEscape(id), body, nil); err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf("Agent %s → %s\n", id, status)
	return nil
}

// AgentsRevoke soft-deletes an agent.
func AgentsRevoke(args []string) error {
	fs := flag.NewFlagSet("agents revoke", flag.ContinueOnError)
	yes := fs.Bool("yes", false, "skip the confirmation prompt")
	setLeafUsage(fs, leafHelp{
		Summary: "Irreversibly revoke an agent. All its keys stop working immediately.",
		Usage:   "aju agents revoke <agent-id> [--yes]",
		Long:    "Prefer 'aju agents pause' if you might want the agent back.",
		Examples: []string{
			"aju agents revoke agt_01HX...",
			"aju agents revoke agt_01HX... --yes",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju agents revoke <id> [--yes]")
	}
	id := fs.Arg(0)

	if !*yes {
		fmt.Printf("Revoke agent %s? This is irreversible. [y/N] ", id)
		var answer string
		if _, err := fmt.Scanln(&answer); err != nil || (answer != "y" && answer != "Y") {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return ErrSilent
		}
	}

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	if err := client.Do(http.MethodDelete, "/api/agents/"+url.PathEscape(id), nil, nil); err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf("Agent %s revoked.\n", id)
	return nil
}

// AgentsGrant grants an agent access to a named brain. The server accepts
// either `brainId` or `brainName`, so we pass the user input directly as
// `brainName` and let the server resolve it against the active org.
func AgentsGrant(args []string) error {
	fs := flag.NewFlagSet("agents grant", flag.ContinueOnError)
	role := fs.String("role", "viewer", "grant role: viewer|editor|owner")
	setLeafUsage(fs, leafHelp{
		Summary: "Grant an agent access to a brain in the active organization.",
		Usage:   "aju agents grant <agent-id> <brain-name> [--role viewer|editor|owner]",
		Examples: []string{
			"aju agents grant agt_01HX... Personal --role editor",
			"aju agents grant agt_01HX... Acme --role viewer",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 2 {
		return errors.New("usage: aju agents grant <id> <brain-name> [--role viewer|editor|owner]")
	}
	id := fs.Arg(0)
	brainName := fs.Arg(1)

	if *role != "viewer" && *role != "editor" && *role != "owner" {
		return fmt.Errorf("invalid --role %q (expected viewer, editor, or owner)", *role)
	}

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	body := map[string]any{"brainName": brainName, "role": *role}
	if err := client.Post("/api/agents/"+url.PathEscape(id)+"/brains", body, nil); err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf("Granted %s on %s to agent %s\n", *role, brainName, id)
	return nil
}

// AgentsActivity prints the recent change-log entries attributed to an agent.
func AgentsActivity(args []string) error {
	fs := flag.NewFlagSet("agents activity", flag.ContinueOnError)
	limit := fs.Int("limit", 50, "maximum number of entries to return")
	setLeafUsage(fs, leafHelp{
		Summary: "List recent change-log events attributed to an agent.",
		Usage:   "aju agents activity <agent-id> [--limit 50]",
		Examples: []string{
			"aju agents activity agt_01HX...",
			"aju agents activity agt_01HX... --limit 200",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju agents activity <id> [--limit 50]")
	}
	id := fs.Arg(0)

	client, _, err := loadAuthedClient()
	if err != nil {
		return err
	}

	params := url.Values{}
	params.Set("limit", strconv.Itoa(*limit))

	var resp agentActivityResp
	if err := client.GetJSON("/api/agents/"+url.PathEscape(id)+"/activity", params, &resp); err != nil {
		return printFriendlyErr(err)
	}

	if len(resp.Entries) == 0 {
		fmt.Fprintln(os.Stderr, "No activity.")
		return nil
	}
	for _, e := range resp.Entries {
		fmt.Printf("%s\t%s\t%s\t%s\n",
			e.CreatedAt.Format(time.RFC3339), e.Operation, e.Source, e.Path)
	}
	return nil
}
