package cmd

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/tomskest/aju/client/cli/internal/config"
	"github.com/tomskest/aju/client/cli/internal/httpx"
	"github.com/tomskest/aju/client/cli/internal/manifest"
	"github.com/tomskest/aju/client/cli/internal/state"
)

// doctorProbeTimeout is the per-probe HTTP timeout. Each probe should be
// quick — doctor is meant to be run interactively.
const doctorProbeTimeout = 5 * time.Second

// Doctor prints a one-screen diagnosis of the local environment. Exit 0 if
// healthy (or only non-critical issues), exit 1 iff the user is signed in
// but the configured server is unreachable — a likely-actionable failure.
func Doctor(args []string) error {
	fs := flag.NewFlagSet("doctor", flag.ContinueOnError)
	installBase := fs.String("install-base", envOr("AJU_INSTALL_BASE", manifest.DefaultInstallBase), "override install worker URL")
	setLeafUsage(fs, leafHelp{
		Summary: "Diagnose local environment and connectivity.",
		Usage:   "aju doctor [--install-base <url>]",
		Long: `Prints version, config path, server reachability, sign-in state, and
latest-available version. Exits non-zero only when you're signed in but
the server is unreachable — the one case that's usually actionable.`,
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	// 1. CLI version
	fmt.Printf("CLI version:     %s\n", CurrentVersion)

	// 2. Config path + readability
	cfgPath, cfgErr := config.Path()
	if cfgErr != nil {
		fmt.Printf("Config path:     (unresolvable: %v)\n", cfgErr)
	} else {
		st, err := os.Stat(cfgPath)
		switch {
		case err != nil && os.IsNotExist(err):
			fmt.Printf("Config path:     %s (not present — run `aju login`)\n", cfgPath)
		case err != nil:
			fmt.Printf("Config path:     %s (unreadable: %v)\n", cfgPath, err)
		default:
			fmt.Printf("Config path:     %s (ok, %d bytes)\n", cfgPath, st.Size())
		}
	}

	cfg, _ := config.Load()
	if cfg == nil {
		cfg = &config.Config{}
	}

	// 3. Server URL + reachability
	server := cfg.ServerURL()
	fmt.Printf("Server URL:      %s\n", server)
	serverReachable := probeURL(server + "/api/public/stats")
	if serverReachable == nil {
		fmt.Printf("  reachable:     yes\n")
	} else {
		fmt.Printf("  reachable:     no (%v)\n", serverReachable)
	}

	// 4. Active org + brain
	org := cfg.Profile().Org
	if org == "" {
		org = "(none)"
	}
	brain := cfg.Profile().Brain
	if brain == "" {
		brain = "(server default)"
	}
	fmt.Printf("Active org:      %s\n", org)
	fmt.Printf("Active brain:    %s\n", brain)

	// 5. Sign-in status
	signedIn := cfg.Profile().Key != ""
	var authErr error
	if signedIn {
		client := httpx.New(server, cfg.Profile().Key)
		client.HTTP = &http.Client{Timeout: doctorProbeTimeout}
		var me meResp
		if err := client.Get("/api/auth/me", &me); err != nil {
			authErr = err
			fmt.Printf("Signed in:       yes (api key configured, but /api/auth/me failed: %v)\n", err)
		} else {
			fmt.Printf("Signed in:       yes (%s)\n", me.identityLabel())
		}
	} else {
		fmt.Printf("Signed in:       no\n")
	}

	// 6. Manifest state + latest available version
	st, _ := state.Load()
	lastCheck := "(never)"
	if st != nil && st.LastManifestCheck != "" {
		lastCheck = st.LastManifestCheck
	}
	fmt.Printf("Last check:      %s\n", lastCheck)
	m, err := manifest.FetchWithTimeout(*installBase, doctorProbeTimeout)
	if err != nil {
		fmt.Printf("Manifest:        unreachable (%v)\n", err)
	} else {
		fmt.Printf("Latest version:  %s\n", m.LatestVersion)
		if m.LatestVersion != "" && m.LatestVersion != "unknown" {
			switch manifest.CompareVersions(CurrentVersion, m.LatestVersion) {
			case 0:
				fmt.Printf("  status:        up to date\n")
			case -1:
				fmt.Printf("  status:        update available (run `aju self-update`)\n")
			case 1:
				fmt.Printf("  status:        ahead of latest (dev build)\n")
			}
		}
		if m.MinSupportedVersion != "" && manifest.CompareVersions(CurrentVersion, m.MinSupportedVersion) < 0 {
			fmt.Printf("  unsupported:   yes — below min %s\n", m.MinSupportedVersion)
		}
	}

	// Exit code policy: fail iff signed in but server unreachable. All other
	// states (not-signed-in, stale manifest, auth failure) are reportable but
	// non-fatal for doctor.
	if signedIn && (serverReachable != nil || authErr != nil) {
		return ErrSilent
	}
	return nil
}

// probeURL does a GET with a short timeout and reports the first transport
// or HTTP (4xx/5xx) failure. A 2xx/3xx response is treated as "reachable".
func probeURL(url string) error {
	client := &http.Client{Timeout: doctorProbeTimeout}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "aju-cli-doctor")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return fmt.Errorf("http %d", resp.StatusCode)
	}
	return nil
}
