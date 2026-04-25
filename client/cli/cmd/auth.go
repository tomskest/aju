package cmd

import (
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/tomskest/aju/client/cli/internal/browser"
	"github.com/tomskest/aju/client/cli/internal/config"
	"github.com/tomskest/aju/client/cli/internal/httpx"
)

// deviceStartResp mirrors the server response for POST /api/auth/device/start.
type deviceStartResp struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURL string `json:"verification_url"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

// devicePollResp mirrors the server response for POST /api/auth/device/poll.
type devicePollResp struct {
	Status string `json:"status"` // "pending" | "approved" | "denied" | "expired"
	APIKey string `json:"api_key,omitempty"`
	Email  string `json:"email,omitempty"`
}

// meResp mirrors GET /api/auth/me. email/userId aren't always present (e.g.
// raw API-key auth returns an identity string like "api-key").
type meResp struct {
	Identity string `json:"identity,omitempty"`
	Email    string `json:"email,omitempty"`
	UserID   string `json:"userId,omitempty"`
	Role     string `json:"role,omitempty"`
}

// identityLabel picks the best human-readable label for a meResp. Prefers
// email → identity → userId → "signed in".
func (m *meResp) identityLabel() string {
	if m.Email != "" {
		return m.Email
	}
	if m.Identity != "" {
		return m.Identity
	}
	if m.UserID != "" {
		return m.UserID
	}
	return "signed in"
}

// Login runs the device code flow end to end, optionally under a named
// profile. Each profile stores one API key and routes to one organization.
//
//	aju login                         # default profile (or AJU_PROFILE override)
//	aju login --profile work          # create/refresh the "work" profile
//	aju login --profile work --set-default   # also switch default to "work"
func Login(args []string) error {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	server := fs.String("server", "", "override server URL for this call")
	profile := fs.String("profile", "", "name of the profile to write the key into (defaults to the active profile)")
	setDefault := fs.Bool("set-default", false, "also make this profile the default for future invocations")
	setLeafUsage(fs, leafHelp{
		Summary: "Sign in via device code flow and write the API key into a profile.",
		Usage:   "aju login [--profile <name>] [--set-default] [--server <url>]",
		Long: `Opens a browser to the server's device-authorization page. When the user
approves, the server returns a fresh API key, which is persisted into the
named profile (or the currently-active profile).`,
		Examples: []string{
			"aju login",
			"aju login --profile work",
			"aju login --profile work --set-default",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if *profile != "" {
		cfg.SetActive(*profile)
	}
	if *server != "" {
		cfg.Profile().Server = *server
	}
	base := cfg.ServerURL()

	client := httpx.New(base, "")

	var start deviceStartResp
	if err := client.Post("/api/auth/device/start", map[string]any{}, &start); err != nil {
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

	fmt.Printf("Open this URL to authorize:\n  %s\n\n", start.VerificationURL)
	fmt.Printf("Or visit %s/cli-auth and enter this code:\n  %s\n\n", base, start.UserCode)
	fmt.Println("Waiting for authorization...")

	if start.VerificationURL != "" {
		if err := browser.Open(start.VerificationURL); err != nil {
			// Non-fatal — the user can open the URL manually.
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
		err := client.Post("/api/auth/device/poll", map[string]any{"device_code": start.DeviceCode}, &poll)
		if err != nil {
			// Transient network failures shouldn't kill the whole flow.
			fmt.Fprintf(os.Stderr, "(poll error: %v)\n", err)
		} else {
			switch poll.Status {
			case "approved":
				if poll.APIKey == "" {
					return fmt.Errorf("server approved login but returned no api_key")
				}
				cfg.Profile().Key = poll.APIKey
				if *setDefault || cfg.DefaultProfile == "" {
					cfg.DefaultProfile = cfg.Active
				}
				if err := config.Save(cfg); err != nil {
					return err
				}
				label := poll.Email
				if label == "" {
					label = fetchIdentity(base, poll.APIKey)
				}
				if label != "" {
					fmt.Printf("Signed in as %s (profile: %s)\n", label, cfg.Active)
				} else {
					fmt.Printf("Signed in (profile: %s).\n", cfg.Active)
				}
				return nil
			case "denied":
				fmt.Println("Authorization denied.")
				os.Exit(1)
			case "expired":
				fmt.Println("Authorization timed out. Run `aju login` again.")
				os.Exit(1)
			case "pending", "":
				// keep polling
			default:
				// Unknown status — keep polling but surface it once.
				fmt.Fprintf(os.Stderr, "(unknown status: %s)\n", poll.Status)
			}
		}

		<-ticker.C
	}
}

// Logout clears the API key while preserving the server URL.
func Logout(args []string) error {
	if anyHelpArg(args) {
		fmt.Print(`Clear the API key from the active profile. Preserves the server URL and
other profile fields so you can re-login with ` + "`aju login`" + ` later.

Usage:
  aju logout
`)
		return nil
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.Profile().Key == "" {
		fmt.Println("Not signed in.")
		return nil
	}
	cfg.Profile().Key = ""
	if err := config.Save(cfg); err != nil {
		return err
	}
	fmt.Println("Signed out.")
	return nil
}

// Status prints the current server, active brain, and sign-in state.
func Status(args []string) error {
	if anyHelpArg(args) {
		fmt.Print(`Print the active profile's server URL, active brain, active org, and
signed-in identity (resolved via /api/auth/me).

Usage:
  aju status
`)
		return nil
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	fmt.Printf("Server:       %s\n", cfg.ServerURL())
	brain := cfg.Profile().Brain
	if brain == "" {
		brain = "(server default)"
	}
	fmt.Printf("Active brain: %s\n", brain)
	org := cfg.Profile().Org
	if org == "" {
		org = "(none)"
	}
	fmt.Printf("Active org:   %s\n", org)

	if cfg.Profile().Key == "" {
		fmt.Println("Signed in as: (not signed in)")
		return nil
	}
	label := fetchIdentity(cfg.ServerURL(), cfg.Profile().Key)
	if label == "" {
		// We have a key but the server can't be reached; still report the
		// key is configured so users know.
		fmt.Println("Signed in as: (could not reach server)")
		return nil
	}
	fmt.Printf("Signed in as: %s\n", label)
	return nil
}

// Whoami prints the email or identity, exit 1 if not signed in.
func Whoami(args []string) error {
	if anyHelpArg(args) {
		fmt.Print(`Print the signed-in identity (email / user id) and exit 1 if not signed in.
Handy for scripting: ` + "`aju whoami >/dev/null 2>&1 && echo logged-in`" + `.

Usage:
  aju whoami
`)
		return nil
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.Profile().Key == "" {
		fmt.Fprintln(os.Stderr, "Not signed in")
		os.Exit(1)
	}

	client := httpx.New(cfg.ServerURL(), cfg.Profile().Key)
	var me meResp
	if err := client.Get("/api/auth/me", &me); err != nil {
		if httpx.IsAuth(err) {
			fmt.Fprintln(os.Stderr, "Not signed in")
			os.Exit(1)
		}
		return err
	}
	fmt.Println(me.identityLabel())
	return nil
}

// fetchIdentity best-efforts a GET /api/auth/me call. Any error is swallowed
// and an empty string is returned (we must not break status/whoami/login
// when the identity endpoint is unavailable).
func fetchIdentity(base, key string) string {
	if key == "" {
		return ""
	}
	client := httpx.New(base, key)
	var me meResp
	if err := client.Get("/api/auth/me", &me); err != nil {
		return ""
	}
	return me.identityLabel()
}
