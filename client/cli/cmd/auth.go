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
				// Auto-provision a profile per non-personal org the user
				// belongs to. The device-flow key has admin scope so it can
				// mint per-org child keys without a second auth round-trip.
				// Non-fatal — login is "done" the moment the device key is
				// saved; this is a UX layer on top.
				if err := autoProvisionOrgProfiles(httpx.New(base, poll.APIKey), cfg); err != nil {
					fmt.Fprintf(os.Stderr, "(could not auto-mint per-org keys: %v)\n", err)
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

// autoProvisionOrgProfiles mints a per-org child key for every org the
// user belongs to that isn't already bound to a local profile. Run after
// `aju login` so a multi-org user gets one profile per org with no further
// prompts.
//
// The device-flow key (in `cfg`'s active profile) has admin scope, which is
// what gates POST /api/keys; child keys themselves get the same scope set
// so subsequent runs (e.g. after joining a new org) can also self-heal.
//
// Skips:
//   - the user's personal org (the unpinned device-flow key already
//     resolves there via the bearer auth fallback)
//   - any org already bound to a local profile (idempotent re-runs)
//   - any org whose slug collides with an existing profile name (the user
//     can resolve manually with `aju keys update`)
func autoProvisionOrgProfiles(client *httpx.Client, cfg *config.Config) error {
	var list orgsListResp
	if err := client.Get("/api/orgs", &list); err != nil {
		return err
	}
	if len(list.Orgs) <= 1 {
		return nil // single-org user — nothing to do
	}

	bindings, err := resolveProfileBindings(client, cfg, &list)
	if err != nil {
		return err
	}

	created := 0
	for _, o := range list.Orgs {
		if o.IsPersonal {
			continue
		}
		if _, bound := bindings[o.Slug]; bound {
			continue
		}
		if _, exists := cfg.Profiles[o.Slug]; exists {
			continue
		}

		body := keysCreateReq{
			Name:           fmt.Sprintf("cli (%s)", o.Slug),
			Scopes:         []string{"read", "write", "delete", "admin"},
			OrganizationID: o.ID,
		}
		var resp keysCreateResp
		if err := client.Post("/api/keys", body, &resp); err != nil {
			fmt.Fprintf(os.Stderr, "(skip %s: %v)\n", o.Slug, err)
			continue
		}
		if resp.Plaintext == "" {
			continue
		}
		if cfg.Profiles == nil {
			cfg.Profiles = map[string]*config.Profile{}
		}
		cfg.Profiles[o.Slug] = &config.Profile{
			Server: cfg.Profile().Server,
			Key:    resp.Plaintext,
			Org:    o.Slug,
		}
		created++
	}

	if created == 0 {
		return nil
	}
	if err := config.Save(cfg); err != nil {
		return err
	}
	noun := "profile"
	if created > 1 {
		noun = "profiles"
	}
	fmt.Printf("Provisioned %d additional %s. Switch with `aju orgs switch <slug>`.\n", created, noun)
	return nil
}

// Logout revokes every per-org key minted by `aju login` and clears them
// from the local config. Server URLs and other profile fields are kept
// so a future `aju login` re-uses the same layout.
//
// Revocation is best-effort: if a key is already revoked server-side, or
// the server is unreachable, we still clear the local state so the device
// stops carrying credentials. The user can clean up dangling rows from
// the dashboard.
func Logout(args []string) error {
	if anyHelpArg(args) {
		fmt.Print(`Revoke every API key minted into a local profile and clear them from
the config. Preserves server URLs so a future ` + "`aju login`" + ` reuses the same
layout.

Usage:
  aju logout
`)
		return nil
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Collect every (profile, prefix) that has a non-empty key. Capturing
	// the prefix up front lets us tolerate the local plaintext being cleared
	// after a partial failure on a previous run.
	type localKey struct{ profile, prefix string }
	var locals []localKey
	for name, p := range cfg.Profiles {
		if p == nil || p.Key == "" {
			continue
		}
		prefix := p.Key
		if len(prefix) > 12 {
			prefix = prefix[:12]
		}
		locals = append(locals, localKey{profile: name, prefix: prefix})
	}
	if len(locals) == 0 {
		fmt.Println("Not signed in.")
		return nil
	}

	// Use the active profile's key (or any working one) to drive the
	// revocation calls. /api/keys lists every key belonging to the user
	// regardless of org pin, so one authenticated request finds them all.
	driverKey := cfg.Profile().Key
	if driverKey == "" {
		// Fall back to any non-empty profile key.
		for _, p := range cfg.Profiles {
			if p != nil && p.Key != "" {
				driverKey = p.Key
				break
			}
		}
	}

	revoked, failed := 0, 0
	if driverKey != "" {
		client := httpx.New(cfg.ServerURL(), driverKey)

		var list keysListResp
		if err := client.Get("/api/keys", &list); err != nil {
			fmt.Fprintf(os.Stderr, "(could not list server keys: %v — clearing local state anyway)\n", err)
		} else {
			prefixToID := make(map[string]string, len(list.Keys))
			for _, k := range list.Keys {
				if k.RevokedAt != "" {
					continue
				}
				prefixToID[k.Prefix] = k.ID
			}
			for _, l := range locals {
				id, ok := prefixToID[l.prefix]
				if !ok {
					// Already revoked or never existed server-side; nothing to do.
					continue
				}
				if err := client.Do("DELETE", "/api/keys/"+id, nil, nil); err != nil {
					fmt.Fprintf(os.Stderr, "(failed to revoke %s [profile %s]: %v)\n", l.prefix, l.profile, err)
					failed++
					continue
				}
				revoked++
			}
		}
	}

	// Clear local state regardless of server-side outcome — the user said
	// "log out", so the device should stop carrying credentials.
	for _, l := range locals {
		if p := cfg.Profiles[l.profile]; p != nil {
			p.Key = ""
		}
	}
	if err := config.Save(cfg); err != nil {
		return err
	}

	switch {
	case revoked > 0 && failed == 0:
		fmt.Printf("Signed out. Revoked %d key(s).\n", revoked)
	case revoked > 0 && failed > 0:
		fmt.Printf("Signed out. Revoked %d key(s); %d failed (cleared locally anyway).\n", revoked, failed)
	default:
		fmt.Println("Signed out (local state cleared).")
	}
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
