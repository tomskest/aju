package cmd

import (
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"time"
)

// Backlinks implements `aju backlinks <path>`.
func Backlinks(args []string) error {
	fs := flag.NewFlagSet("backlinks", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	setLeafUsage(fs, leafHelp{
		Summary: "List documents that link to <path>.",
		Usage:   "aju backlinks <path> [--brain <name>] [--json]",
		Examples: []string{
			"aju backlinks 03-Product/okrs.md",
			"aju backlinks 03-Product/okrs.md --brain Acme --json",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju backlinks <path> [--brain <name>]")
	}
	path := fs.Arg(0)

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}
	params := url.Values{}
	params.Set("path", path)
	addBrain(params, resolveBrainFlag(*brain, cfg))

	var resp struct {
		Path      string `json:"path"`
		Count     int    `json:"count"`
		Backlinks []struct {
			LinkText string `json:"linkText"`
			Source   struct {
				Path  string `json:"path"`
				Title string `json:"title"`
			} `json:"source"`
		} `json:"backlinks"`
	}
	if err := client.GetJSON("/api/vault/backlinks", params, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if *jsonOut {
		return printJSON(&resp)
	}
	if resp.Count == 0 {
		fmt.Fprintln(os.Stderr, "No backlinks.")
		return nil
	}
	for _, b := range resp.Backlinks {
		fmt.Printf("%s\t%s\n", b.Source.Path, b.Source.Title)
	}
	return nil
}

// Related implements `aju related <path>`.
func Related(args []string) error {
	fs := flag.NewFlagSet("related", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	setLeafUsage(fs, leafHelp{
		Summary: "Show related documents (outbound links + shared tags).",
		Usage:   "aju related <path> [--brain <name>] [--json]",
		Examples: []string{
			"aju related 03-Product/okrs.md",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju related <path> [--brain <name>]")
	}
	path := fs.Arg(0)

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}
	params := url.Values{}
	params.Set("path", path)
	addBrain(params, resolveBrainFlag(*brain, cfg))

	var resp struct {
		Path    string `json:"path"`
		Count   int    `json:"count"`
		Related []struct {
			Path         string `json:"path"`
			Title        string `json:"title"`
			Section      string `json:"section"`
			Relationship string `json:"relationship"`
		} `json:"related"`
	}
	if err := client.GetJSON("/api/vault/related", params, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if *jsonOut {
		return printJSON(&resp)
	}
	if resp.Count == 0 {
		fmt.Fprintln(os.Stderr, "No related documents.")
		return nil
	}
	for _, r := range resp.Related {
		fmt.Printf("%s\t%s\t%s\n", r.Path, r.Relationship, r.Title)
	}
	return nil
}

// Graph implements `aju graph [--mode stats|neighbors] [--path <p>]`.
func Graph(args []string) error {
	fs := flag.NewFlagSet("graph", flag.ContinueOnError)
	mode := fs.String("mode", "stats", "stats|neighbors")
	path := fs.String("path", "", "document path (required for --mode neighbors)")
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	setLeafUsage(fs, leafHelp{
		Summary: "Inspect the link graph: brain-wide stats or a single-document ego-net.",
		Usage:   "aju graph [--mode stats|neighbors] [--path <p>] [--brain <name>] [--json]",
		Examples: []string{
			"aju graph",
			"aju graph --mode neighbors --path 03-Product/okrs.md",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if *mode != "stats" && *mode != "neighbors" {
		return fmt.Errorf("invalid --mode %q (expected stats or neighbors)", *mode)
	}
	if *mode == "neighbors" && *path == "" {
		return errors.New("--path is required with --mode neighbors")
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}
	params := url.Values{}
	params.Set("mode", *mode)
	if *path != "" {
		params.Set("path", *path)
	}
	addBrain(params, resolveBrainFlag(*brain, cfg))

	if *mode == "stats" {
		var resp struct {
			TotalDocuments      int `json:"totalDocuments"`
			TotalLinks          int `json:"totalLinks"`
			OrphanDocuments     int `json:"orphanDocuments"`
			MostLinkedDocuments []struct {
				Path          string `json:"path"`
				Title         string `json:"title"`
				IncomingLinks int    `json:"incomingLinks"`
			} `json:"mostLinkedDocuments"`
		}
		if err := client.GetJSON("/api/vault/graph", params, &resp); err != nil {
			return printFriendlyErr(err)
		}
		if *jsonOut {
			return printJSON(&resp)
		}
		fmt.Printf("Documents:\t%d\n", resp.TotalDocuments)
		fmt.Printf("Links:\t\t%d\n", resp.TotalLinks)
		fmt.Printf("Orphans:\t%d\n", resp.OrphanDocuments)
		if len(resp.MostLinkedDocuments) > 0 {
			fmt.Println("\nMost-linked-to:")
			for _, d := range resp.MostLinkedDocuments {
				fmt.Printf("  %d\t%s\n", d.IncomingLinks, d.Path)
			}
		}
		return nil
	}

	// neighbors
	var resp struct {
		Center string `json:"center"`
		Nodes  []struct {
			Path  string `json:"path"`
			Title string `json:"title"`
		} `json:"nodes"`
		Edges []struct {
			Source string `json:"source"`
			Target string `json:"target"`
			Hop    int    `json:"hop"`
		} `json:"edges"`
	}
	if err := client.GetJSON("/api/vault/graph", params, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if *jsonOut {
		return printJSON(&resp)
	}
	fmt.Printf("Center: %s\n", resp.Center)
	fmt.Printf("Nodes: %d, Edges: %d\n", len(resp.Nodes), len(resp.Edges))
	for _, e := range resp.Edges {
		fmt.Printf("  (hop %d) %s -> %s\n", e.Hop, e.Source, e.Target)
	}
	return nil
}

// RebuildLinks implements `aju rebuild-links`. Posts to
// /api/vault/rebuild-links and prints the rebuilt count.
func RebuildLinks(args []string) error {
	fs := flag.NewFlagSet("rebuild-links", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	setLeafUsage(fs, leafHelp{
		Summary: "Rebuild the link index for the active (or --brain) brain.",
		Usage:   "aju rebuild-links [--brain <name>]",
		Long:    "Rarely needed — the server rebuilds incrementally on writes. Use after a bulk import or if 'aju backlinks'/'aju related' look stale.",
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	target := "/api/vault/rebuild-links"
	if b := resolveBrainFlag(*brain, cfg); b != "" {
		target += "?brain=" + url.QueryEscape(b)
	}

	var resp struct {
		Rebuilt int `json:"rebuilt"`
	}
	if err := client.PostJSON(target, map[string]any{}, &resp); err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf("Rebuilt %d links.\n", resp.Rebuilt)
	return nil
}

// AutoLink implements `aju auto-link`. Posts to /api/vault/auto-link and
// reports how many docs were updated and how many wikilinks were inserted.
//
// Auto-link runs server-side on every vault create/update too, so this
// command is mostly for backfill: re-run after seeding hub docs into a
// brain so existing content picks up the new wikilink targets.
func AutoLink(args []string) error {
	fs := flag.NewFlagSet("auto-link", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	setLeafUsage(fs, leafHelp{
		Summary: "Re-scan the brain and insert [[wikilinks]] for mentions of other docs.",
		Usage:   "aju auto-link [--brain <name>]",
		Long:    "Idempotent — running on a fully-linked brain is a no-op. Existing manually-written wikilinks are never touched. Use after adding hub docs (e.g. customers/oj-travel.md) so prior content links to them retroactively. Always chains a rebuild of the link graph.",
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	target := "/api/vault/auto-link"
	if b := resolveBrainFlag(*brain, cfg); b != "" {
		target += "?brain=" + url.QueryEscape(b)
	}

	var resp struct {
		Brain     string `json:"brain"`
		AutoLinks struct {
			Documents  int `json:"documents"`
			TotalAdded int `json:"totalAdded"`
			Updated    int `json:"updated"`
		} `json:"autoLinks"`
		Links struct {
			Resolved   int `json:"resolved"`
			Unresolved int `json:"unresolved"`
		} `json:"links"`
		DurationMs int `json:"durationMs"`
	}
	if err := client.PostJSON(target, map[string]any{}, &resp); err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf(
		"Auto-linked %d/%d docs in %q — added %d wikilink(s); graph: %d resolved, %d unresolved (%d ms).\n",
		resp.AutoLinks.Updated,
		resp.AutoLinks.Documents,
		resp.Brain,
		resp.AutoLinks.TotalAdded,
		resp.Links.Resolved,
		resp.Links.Unresolved,
		resp.DurationMs,
	)
	return nil
}

// Changes implements `aju changes [--since <ISO>] [--exclude-source <src>] [--limit N]`.
func Changes(args []string) error {
	fs := flag.NewFlagSet("changes", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (default active brain; comma-separated list, or 'all')")
	since := fs.String("since", "", "ISO-8601 timestamp (default: 24h ago)")
	excludeSource := fs.String("exclude-source", "", "exclude changes from a given source")
	limit := fs.Int("limit", 200, "maximum changes to return")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	setLeafUsage(fs, leafHelp{
		Summary: "Show recent change-log entries across one or many brains.",
		Usage:   "aju changes [--since <ISO>] [--exclude-source <src>] [--limit N] [--brain <name|a,b|all>] [--json]",
		Long:    "Tab-separated: createdAt, operation, path, source, changedBy.",
		Examples: []string{
			"aju changes",
			"aju changes --since 2026-04-20T00:00:00Z --exclude-source aju-cli",
			"aju changes --brain all --limit 500",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	sinceValue := *since
	if sinceValue == "" {
		sinceValue = time.Now().Add(-24 * time.Hour).UTC().Format(time.RFC3339)
	}

	params := url.Values{}
	params.Set("since", sinceValue)
	params.Set("limit", strconv.Itoa(*limit))
	if *excludeSource != "" {
		params.Set("excludeSource", *excludeSource)
	}
	addBrains(params, parseBrainList(*brain, cfg))

	var resp struct {
		Changes []struct {
			Operation string `json:"operation"`
			Path      string `json:"path"`
			Source    string `json:"source"`
			ChangedBy string `json:"changedBy"`
			CreatedAt string `json:"createdAt"`
		} `json:"changes"`
	}
	if err := client.GetJSON("/api/vault/changes", params, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if *jsonOut {
		return printJSON(&resp)
	}
	if len(resp.Changes) == 0 {
		fmt.Fprintln(os.Stderr, "No changes.")
		return nil
	}
	for _, c := range resp.Changes {
		fmt.Printf("%s\t%s\t%s\t%s\t%s\n",
			c.CreatedAt,
			c.Operation,
			c.Path,
			c.Source,
			c.ChangedBy,
		)
	}
	return nil
}
