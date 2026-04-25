package cmd

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/tomskest/aju/cli/internal/config"
	"github.com/tomskest/aju/cli/internal/httpx"
)

// ErrSilent is returned by handlers that have already written a user-facing
// message to stderr and want main.exitWith to exit 1 without printing again.
var ErrSilent = errors.New("silent error")

// ErrHelpHandled is returned when the user asked for --help / -h on a leaf
// command and the usage block has already been printed. main.exitWith treats
// it as a zero-exit success — help is an intentional action, not an error.
var ErrHelpHandled = errors.New("help handled")

// CurrentVersion is the running CLI's version string. main.go assigns it at
// startup (mirroring the httpx.Version pattern) so cmd code can compare
// against the manifest without importing the main package.
var CurrentVersion = "dev"

// loadAuthedClient returns a Client signed with the active API key plus the
// loaded Config. It returns a friendly error when no API key is configured.
func loadAuthedClient() (*httpx.Client, *config.Config, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, err
	}
	if cfg.Profile().Key == "" {
		return nil, cfg, errors.New("Not signed in — run `aju login`")
	}
	return httpx.New(cfg.ServerURL(), cfg.Profile().Key), cfg, nil
}

// resolveBrainFlag returns the brain name to send with the next API call.
// The CLI flag wins over the config value; an empty string means "use server
// default" and the param is simply omitted.
func resolveBrainFlag(flagValue string, cfg *config.Config) string {
	if flagValue != "" {
		return flagValue
	}
	if cfg != nil {
		return cfg.Profile().Brain
	}
	return ""
}

// addBrain mutates params so the server-side brain resolver receives the
// correct target. It is a no-op when name is empty.
func addBrain(params url.Values, name string) {
	if name != "" {
		params.Set("brain", name)
	}
}

// addBrains mutates params with one `brain` entry per name so the server-side
// resolver treats the call as multi-brain. An empty list is a no-op (server
// falls back to the caller's default). "all" is passed through verbatim.
func addBrains(params url.Values, names []string) {
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		params.Add("brain", n)
	}
}

// parseBrainList splits a --brain flag value that may be empty, a single
// name, "all", or a comma-separated list. Config fallback only applies when
// the flag is empty.
func parseBrainList(flagValue string, cfg *config.Config) []string {
	v := strings.TrimSpace(flagValue)
	if v == "" && cfg != nil {
		v = cfg.Profile().Brain
	}
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, dup := seen[p]; dup {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

// printFriendlyErr translates typed httpx errors into user-facing one-liners.
// It writes to stderr and returns ErrSilent so main.exitWith doesn't print the
// error a second time. Unknown errors fall through unchanged.
func printFriendlyErr(err error) error {
	if err == nil {
		return nil
	}
	if httpx.IsAuth(err) {
		fmt.Fprintln(os.Stderr, "Authentication failed — run `aju login`")
		return ErrSilent
	}
	if httpx.IsNetwork(err) {
		fmt.Fprintf(os.Stderr, "Network error: %v\n", err)
		return ErrSilent
	}
	// HTTP errors and decode errors fall through — main prints them once.
	return err
}
