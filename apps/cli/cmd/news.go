package cmd

import (
	"flag"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/tomskest/aju/cli/internal/manifest"
	"github.com/tomskest/aju/cli/internal/state"
)

// News prints all currently-valid announcements from the manifest. The
// already-seen list is updated in state.json so the pre-dispatch check and
// the user-invoked `aju news` command stay in sync.
func News(args []string) error {
	fs := flag.NewFlagSet("news", flag.ContinueOnError)
	showAll := fs.Bool("all", false, "replay even already-seen announcements")
	installBase := fs.String("install-base", envOr("AJU_INSTALL_BASE", manifest.DefaultInstallBase), "override install worker URL")
	setLeafUsage(fs, leafHelp{
		Summary: "Show product announcements. Once-seen items are hidden unless --all.",
		Usage:   "aju news [--all] [--install-base <url>]",
		Examples: []string{
			"aju news",
			"aju news --all",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	m, err := manifest.Fetch(*installBase)
	if err != nil {
		return fmt.Errorf("fetch manifest: %w", err)
	}

	st, _ := state.Load() // Missing/invalid state is not fatal — treat as empty.
	if st == nil {
		st = &state.State{}
	}

	now := time.Now().UTC()
	seen := stringSet(st.SeenAnnouncementIDs)
	var toShow []manifest.Announcement
	for _, a := range m.Announcements {
		if !inWindow(a, now) {
			continue
		}
		if !*showAll {
			if _, ok := seen[a.ID]; ok {
				continue
			}
		}
		toShow = append(toShow, a)
	}

	if len(toShow) == 0 {
		fmt.Println("No new announcements.")
		return nil
	}

	sort.Slice(toShow, func(i, j int) bool {
		return toShow[i].ID < toShow[j].ID
	})

	for i, a := range toShow {
		if i > 0 {
			fmt.Println()
		}
		printAnnouncement(a)
	}

	// Record them as seen (always — even under --all — so recurring reads
	// don't keep spamming the user).
	changed := false
	for _, a := range toShow {
		if _, ok := seen[a.ID]; ok {
			continue
		}
		st.SeenAnnouncementIDs = append(st.SeenAnnouncementIDs, a.ID)
		seen[a.ID] = struct{}{}
		changed = true
	}
	if changed {
		_ = state.Save(st)
	}
	return nil
}

// printAnnouncement writes a single announcement to stdout.
// The title is bolded via ANSI; non-TTY callers just see the escape codes —
// acceptable for a plain-text CLI and consistent with other aju output.
func printAnnouncement(a manifest.Announcement) {
	title := strings.TrimSpace(a.Title)
	if title == "" {
		title = a.ID
	}
	// \033[1m ... \033[0m = bold.
	fmt.Printf("\033[1m%s\033[0m\n", title)
	if body := strings.TrimSpace(a.Body); body != "" {
		fmt.Println(body)
	}
	if a.URL != "" {
		fmt.Printf("→ %s\n", a.URL)
	}
}

// inWindow reports whether now is within [ShowAfter, ShowUntil]. Missing
// bounds are treated as open-ended; unparseable timestamps are permissive
// so a malformed manifest never hides announcements entirely.
func inWindow(a manifest.Announcement, now time.Time) bool {
	if a.ShowAfter != "" {
		if t, err := time.Parse(time.RFC3339, a.ShowAfter); err == nil {
			if now.Before(t) {
				return false
			}
		}
	}
	if a.ShowUntil != "" {
		if t, err := time.Parse(time.RFC3339, a.ShowUntil); err == nil {
			if now.After(t) {
				return false
			}
		}
	}
	return true
}

// stringSet turns a slice into a membership set.
func stringSet(ss []string) map[string]struct{} {
	out := make(map[string]struct{}, len(ss))
	for _, s := range ss {
		out[s] = struct{}{}
	}
	return out
}
