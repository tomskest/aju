package cmd

import (
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/tomskest/aju/cli/internal/browser"
	"github.com/tomskest/aju/cli/internal/config"
	"github.com/tomskest/aju/cli/internal/httpx"
)

// AgentProvision runs the device-code flow against a named agent, writing
// the minted agent-scoped API key into a profile. Mirrors Login but with
// intent=agent so the approver is shown an agent-specific approval page
// and the server mints an agent key instead of a user key.
//
//	aju agent-provision <agent-name>
//	aju agent-provision <agent-name> --profile openclaw
//	aju agent-provision <agent-name> --profile openclaw --set-default
//
// The agent must already exist (via `aju agents create`) and have brain
// grants configured — this command only mints the authentication key.
func AgentProvision(args []string) error {
	fs := flag.NewFlagSet("agent-provision", flag.ContinueOnError)
	server := fs.String("server", "", "override server URL for this call")
	profile := fs.String("profile", "", "profile name to write the agent key into (defaults to the agent name)")
	setDefault := fs.Bool("set-default", false, "also make this profile the default for future invocations")
	setLeafUsage(fs, leafHelp{
		Summary: "Mint an agent-scoped API key on this machine via device code flow.",
		Usage:   "aju agent-provision <agent-name> [--profile <name>] [--set-default] [--server <url>]",
		Long: `The agent must already exist (create it with 'aju agents create') and have
brain grants configured. This command only mints the authentication key and
writes it into a local profile. By default the profile is named after the
agent, so 'aju agent-provision openclaw' writes to the "openclaw" profile.`,
		Examples: []string{
			"aju agent-provision openclaw",
			"aju agent-provision openclaw --profile openclaw-laptop",
			"aju agent-provision openclaw --set-default",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	positional := fs.Args()
	if len(positional) != 1 {
		fmt.Fprintln(os.Stderr, "Usage: aju agent-provision <agent-name> [--profile <name>] [--set-default]")
		return fmt.Errorf("missing agent name")
	}
	agentName := positional[0]

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Default profile name to the agent name — makes the common case of
	// one-agent-per-box trivial: `aju agent-provision openclaw` writes to
	// profile "openclaw", no flag needed.
	profileName := *profile
	if profileName == "" {
		profileName = agentName
	}
	cfg.SetActive(profileName)
	if *server != "" {
		cfg.Profile().Server = *server
	}
	base := cfg.ServerURL()

	client := httpx.New(base, "")

	var start deviceStartResp
	if err := client.Post(
		"/api/auth/device/start",
		map[string]any{
			"intent":     "agent",
			"agent_name": agentName,
		},
		&start,
	); err != nil {
		return fmt.Errorf("start device flow: %w", err)
	}

	if start.DeviceCode == "" {
		return fmt.Errorf("server returned empty device_code")
	}
	interval := start.Interval
	if interval <= 0 {
		interval = 2
	}
	expires := start.ExpiresIn
	if expires <= 0 {
		expires = 600
	}

	fmt.Printf("Provisioning agent %q.\n\n", agentName)
	fmt.Printf("Open this URL on your laptop to authorize:\n  %s\n\n", start.VerificationURL)
	fmt.Printf("Or visit %s/cli-auth and enter this code:\n  %s\n\n", base, start.UserCode)
	fmt.Println("Waiting for authorization...")

	if start.VerificationURL != "" {
		if err := browser.Open(start.VerificationURL); err != nil {
			// Non-fatal — on a headless remote box this is expected.
			fmt.Fprintf(os.Stderr, "(could not open browser automatically: %v)\n", err)
		}
	}

	deadline := time.Now().Add(time.Duration(expires) * time.Second)
	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	defer ticker.Stop()

	for {
		if time.Now().After(deadline) {
			fmt.Println("Timed out.")
			os.Exit(1)
		}

		var poll devicePollResp
		err := client.Post(
			"/api/auth/device/poll",
			map[string]any{"device_code": start.DeviceCode},
			&poll,
		)
		if err != nil {
			// Transient network failures shouldn't kill the whole flow.
			fmt.Fprintf(os.Stderr, "(poll error: %v)\n", err)
		} else {
			switch poll.Status {
			case "approved":
				if poll.APIKey == "" {
					return fmt.Errorf("server approved provision but returned no api_key")
				}
				cfg.Profile().Key = poll.APIKey
				if *setDefault || cfg.DefaultProfile == "" {
					cfg.DefaultProfile = cfg.Active
				}
				if err := config.Save(cfg); err != nil {
					return err
				}
				fmt.Printf("Provisioned as agent %q (profile: %s).\n", agentName, cfg.Active)
				fmt.Println("Run `aju brains list` to confirm what this agent can see.")
				return nil
			case "denied":
				fmt.Println("Authorization denied.")
				os.Exit(1)
			case "expired":
				fmt.Println("Authorization timed out. Run `aju agent-provision` again.")
				os.Exit(1)
			case "pending", "":
				// keep polling
			default:
				fmt.Fprintf(os.Stderr, "(unknown status: %s)\n", poll.Status)
			}
		}

		<-ticker.C
	}
}
