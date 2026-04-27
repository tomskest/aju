package cmd

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/tomskest/aju/client/cli/internal/manifest"
	"github.com/tomskest/aju/client/cli/internal/state"
)

// preCheckTimeout bounds the pre-dispatch manifest fetch. Kept very short so
// user commands never stall waiting for the worker.
const preCheckTimeout = 5 * time.Second

// preCheckInterval is the minimum gap between background manifest refreshes.
// 24h matches the spec — we don't want to hammer the worker.
const preCheckInterval = 24 * time.Hour

// skipPreCheckCmds lists commands that should never trigger the pre-dispatch
// check. Anything network-sensitive, low-signal, or recursive with the
// check itself belongs here.
var skipPreCheckCmds = map[string]struct{}{
	"version":     {},
	"--version":   {},
	"-v":          {},
	"help":        {},
	"--help":      {},
	"-h":          {},
	"update":      {},
	"self-update": {},
	"news":        {},
	"doctor":      {},
}

// ErrOutdatedUnsupported is returned to signal main() that the running CLI is
// older than MinSupportedVersion and must be updated before proceeding.
var ErrOutdatedUnsupported = errors.New("cli version unsupported")

// PreDispatch runs the best-effort manifest check before a user command. It:
//
//  1. skips entirely for commands in skipPreCheckCmds or when AJU_QUIET=1
//  2. honors a 24h cache in state.LastManifestCheck
//  3. fetches the manifest with a 5s timeout, absorbing any failure silently
//  4. prints a one-line update hint if a newer version is available
//  5. surfaces any unseen announcements and records them as seen
//  6. returns ErrOutdatedUnsupported iff current < min_supported_version
//
// All error paths other than the "unsupported" hard-stop are swallowed — a
// flaky network or a malformed manifest must never break normal commands.
func PreDispatch(commandName string) error {
	if os.Getenv("AJU_QUIET") == "1" {
		return nil
	}
	if _, skip := skipPreCheckCmds[commandName]; skip {
		return nil
	}

	st, err := state.Load()
	if err != nil || st == nil {
		st = &state.State{}
	}

	// Honor the 24h cache. We still parse announcements from the cached
	// state (handled elsewhere — nothing to do here) so a cache hit just
	// means "don't refetch".
	if st.LastManifestCheck != "" {
		if last, err := time.Parse(time.RFC3339, st.LastManifestCheck); err == nil {
			if time.Since(last) < preCheckInterval {
				return nil
			}
		}
	}

	installBase := envOr("AJU_INSTALL_BASE", manifest.DefaultInstallBase)
	m, fetchErr := manifest.FetchWithTimeout(installBase, preCheckTimeout)

	// Record the attempt regardless of success so a flaky worker doesn't
	// burn our 24h budget forever.
	st.LastManifestCheck = time.Now().UTC().Format(time.RFC3339)
	_ = state.Save(st)

	if fetchErr != nil || m == nil {
		return nil
	}

	current := CurrentVersion

	// Hard stop: below min_supported_version.
	if m.MinSupportedVersion != "" && m.MinSupportedVersion != "unknown" {
		if manifest.CompareVersions(current, m.MinSupportedVersion) < 0 {
			fmt.Fprintf(os.Stderr,
				"Your CLI (%s) is no longer supported. Minimum supported version: %s.\nRun `aju self-update` to upgrade.\n",
				current, m.MinSupportedVersion,
			)
			return ErrOutdatedUnsupported
		}
	}

	// Soft hint: newer version available.
	if m.LatestVersion != "" && m.LatestVersion != "unknown" {
		if manifest.CompareVersions(current, m.LatestVersion) < 0 {
			fmt.Fprintf(os.Stderr, "Update available: %s (run `aju self-update`)\n", m.LatestVersion)
		}
	}

	// Any unseen announcements currently in window — print once and mark seen.
	if len(m.Announcements) > 0 {
		seen := stringSet(st.SeenAnnouncementIDs)
		now := time.Now().UTC()
		changed := false
		for _, a := range m.Announcements {
			if !inWindow(a, now) {
				continue
			}
			if _, ok := seen[a.ID]; ok {
				continue
			}
			// Terse inline form for the pre-dispatch printout — the full
			// body is reserved for `aju news`.
			title := a.Title
			if title == "" {
				title = a.ID
			}
			if a.URL != "" {
				fmt.Fprintf(os.Stderr, "News: %s — %s\n", title, a.URL)
			} else {
				fmt.Fprintf(os.Stderr, "News: %s\n", title)
			}
			st.SeenAnnouncementIDs = append(st.SeenAnnouncementIDs, a.ID)
			seen[a.ID] = struct{}{}
			changed = true
		}
		if changed {
			_ = state.Save(st)
		}
	}

	return nil
}
