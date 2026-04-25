package cmd

import (
	"flag"
	"fmt"
	"net/url"
	"os"
	"time"
)

// reindexLinks mirrors the rebuildLinks return shape on the server.
type reindexLinks struct {
	Documents  int `json:"documents"`
	Resolved   int `json:"resolved"`
	Unresolved int `json:"unresolved"`
}

type reindexResponse struct {
	OK                  bool          `json:"ok"`
	Brain               string        `json:"brain"`
	FtsRefreshed        int           `json:"ftsRefreshed"`
	EmbeddingsGenerated int           `json:"embeddingsGenerated"`
	EmbeddingsFailed    int           `json:"embeddingsFailed"`
	Links               *reindexLinks `json:"links,omitempty"`
	DurationMs          int           `json:"durationMs"`
}

// Reindex implements `aju reindex [--brain <n>] [--refresh-all] [--no-fts]
// [--no-embeddings] [--no-links] [--json]`. Forces the server to repopulate
// FTS, embeddings, and the wikilink graph for the scoped brain — useful
// when create/update fire-and-forget indexing has silently failed (e.g.
// Voyage 429) or when rows pre-date the FTS trigger.
func Reindex(args []string) error {
	fs := flag.NewFlagSet("reindex", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	refreshAll := fs.Bool("refresh-all", false, "redo every document, not just rows with missing indexes")
	noFts := fs.Bool("no-fts", false, "skip the FTS backfill")
	noEmbeddings := fs.Bool("no-embeddings", false, "skip the embedding backfill")
	noLinks := fs.Bool("no-links", false, "skip the wikilink graph rebuild")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	setLeafUsage(fs, leafHelp{
		Summary: "Repopulate FTS, embeddings, and wikilinks for a brain.",
		Usage:   "aju reindex [--brain <name>] [--refresh-all] [--no-fts] [--no-embeddings] [--no-links] [--json]",
		Long: `Useful when create/update fire-and-forget indexing has silently failed
(e.g. Voyage 429) or when rows pre-date the FTS trigger. By default only
rows with missing indexes are touched; --refresh-all redoes everything.`,
		Examples: []string{
			"aju reindex",
			"aju reindex --refresh-all",
			"aju reindex --brain Acme --no-links",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	target := "/api/vault/reindex"
	if b := resolveBrainFlag(*brain, cfg); b != "" {
		target += "?brain=" + url.QueryEscape(b)
	}

	body := map[string]any{
		"refreshAll": *refreshAll,
		"fts":        !*noFts,
		"embeddings": !*noEmbeddings,
		"links":      !*noLinks,
	}

	start := time.Now()
	var resp reindexResponse
	if err := client.PostJSON(target, body, &resp); err != nil {
		return printFriendlyErr(err)
	}

	if *jsonOut {
		return printJSON(&resp)
	}

	fmt.Fprintf(
		os.Stderr,
		"Reindexed brain '%s' in %dms (round-trip %s)\n",
		resp.Brain,
		resp.DurationMs,
		time.Since(start).Round(time.Millisecond),
	)
	fmt.Printf("FTS refreshed:         %d rows\n", resp.FtsRefreshed)
	fmt.Printf("Embeddings generated:  %d\n", resp.EmbeddingsGenerated)
	if resp.EmbeddingsFailed > 0 {
		fmt.Printf("Embeddings failed:     %d  (see server logs; retry --refresh-all once quota clears)\n", resp.EmbeddingsFailed)
	}
	if resp.Links != nil {
		fmt.Printf(
			"Links:                 %d documents, %d resolved, %d unresolved\n",
			resp.Links.Documents,
			resp.Links.Resolved,
			resp.Links.Unresolved,
		)
	}
	return nil
}
