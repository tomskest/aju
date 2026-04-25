package cmd

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// searchResult matches the shape returned by /api/vault/search and
// /api/vault/semantic-search (superset of both).
type searchResult struct {
	ID         string   `json:"id,omitempty"`
	Path       string   `json:"path"`
	Title      string   `json:"title,omitempty"`
	Section    string   `json:"section,omitempty"`
	DocType    string   `json:"docType,omitempty"`
	DocStatus  string   `json:"docStatus,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	WordCount  int      `json:"wordCount,omitempty"`
	SourceType string   `json:"sourceType,omitempty"`
	MimeType   string   `json:"mimeType,omitempty"`
	Brain      string   `json:"brain,omitempty"`
	Rank       float64  `json:"rank,omitempty"`
	RRFScore   float64  `json:"rrfScore,omitempty"`
	Similarity float64  `json:"similarity,omitempty"`
	Snippet    string   `json:"snippet,omitempty"`
}

type searchResponse struct {
	Query   string         `json:"query"`
	Mode    string         `json:"mode,omitempty"`
	Brains  []string       `json:"brains,omitempty"`
	Count   int            `json:"count"`
	Results []searchResult `json:"results"`
}

// Search runs the keyword search command.
func Search(args []string) error {
	fs := flag.NewFlagSet("search", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name, comma-separated list ('a,b'), or 'all' (defaults to active brain)")
	limit := fs.Int("limit", 20, "maximum results to return")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	setLeafUsage(fs, leafHelp{
		Summary: "Keyword (FTS) search across one or many brains.",
		Usage:   "aju search <query> [--brain <name|a,b|all>] [--limit N] [--json]",
		Examples: []string{
			"aju search \"NDC parity\"",
			"aju search ndc --brain Personal,Acme",
			"aju search ndc --brain all --limit 50",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	query := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if query == "" {
		return errors.New("usage: aju search <query> [--brain <name|a,b|all>] [--limit <n>] [--json]")
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	params := url.Values{}
	params.Set("q", query)
	params.Set("limit", strconv.Itoa(*limit))
	addBrains(params, parseBrainList(*brain, cfg))

	var resp searchResponse
	if err := client.GetJSON("/api/vault/search", params, &resp); err != nil {
		return printFriendlyErr(err)
	}

	if *jsonOut {
		return printJSON(&resp)
	}
	printSearchResults(resp.Results)
	return nil
}

// deepSearchResult matches the per-result shape returned by
// /api/vault/deep-search (GraphRAG: hybrid seeds + 1-hop graph expansion).
type deepSearchResult struct {
	Path       string   `json:"path"`
	Title      string   `json:"title,omitempty"`
	Section    string   `json:"section,omitempty"`
	DocType    string   `json:"docType,omitempty"`
	DocStatus  string   `json:"docStatus,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	WordCount  int      `json:"wordCount,omitempty"`
	Score      float64  `json:"score"`
	Source     string   `json:"source"` // "seed" | "graph"
	Similarity *float64 `json:"similarity,omitempty"`
	Hop        int      `json:"hop"`
	LinkedFrom []string `json:"linkedFrom,omitempty"`
}

type deepSearchEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Hop  int    `json:"hop"`
}

// deepSearchGraph tolerates two server shapes for `edges`:
//   - array of {from,to,hop}   (normal success path)
//   - number (edge count)      (emitted on the empty-seed short-circuit)
//
// A count alone carries no connectivity, so we leave Edges nil in that case.
type deepSearchGraph struct {
	Nodes int              `json:"nodes"`
	Edges []deepSearchEdge `json:"edges"`
}

func (g *deepSearchGraph) UnmarshalJSON(data []byte) error {
	var raw struct {
		Nodes int             `json:"nodes"`
		Edges json.RawMessage `json:"edges"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	g.Nodes = raw.Nodes
	trimmed := strings.TrimSpace(string(raw.Edges))
	if trimmed == "" || trimmed == "null" {
		return nil
	}
	if trimmed[0] == '[' {
		return json.Unmarshal(raw.Edges, &g.Edges)
	}
	return nil
}

type deepSearchResponse struct {
	Query   string             `json:"query"`
	Mode    string             `json:"mode,omitempty"`
	Depth   int                `json:"depth"`
	Seeds   int                `json:"seeds"`
	Count   int                `json:"count"`
	Results []deepSearchResult `json:"results"`
	Graph   deepSearchGraph    `json:"graph"`
}

// DeepSearch runs GraphRAG deep search: hybrid seeds + 1–2 hop graph
// expansion, re-ranked by a blended score. Best when the user is asking
// questions that span multiple linked documents rather than a single note.
func DeepSearch(args []string) error {
	fs := flag.NewFlagSet("deep-search", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (default active brain; comma-separated list, or 'all')")
	section := fs.String("section", "", "filter seeds by vault section (e.g. '06-Sales')")
	docType := fs.String("type", "", "filter seeds by document type")
	seeds := fs.Int("seeds", 5, "number of hybrid-search seed documents (max 20)")
	limit := fs.Int("limit", 20, "maximum results to return (max 100)")
	depth := fs.Int("depth", 1, "graph expansion depth: 1 or 2")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	setLeafUsage(fs, leafHelp{
		Summary: "GraphRAG search: hybrid seeds + 1–2 hop graph expansion, blended re-rank.",
		Usage:   "aju deep-search <query> [--brain <name|a,b|all>] [--section <s>] [--type <t>] [--seeds N] [--limit N] [--depth 1|2] [--json]",
		Long:    "Best when the answer spans multiple linked documents. Single-note questions are usually faster via 'aju semantic'.",
		Examples: []string{
			"aju deep-search \"why did we pick NDC over GDS\" --depth 2",
			"aju deep-search okrs --section 03-Product --seeds 8 --limit 30",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	query := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if query == "" {
		return errors.New("usage: aju deep-search <query> [--brain <name|a,b|all>] [--section <s>] [--type <t>] [--seeds <n>] [--limit <n>] [--depth 1|2] [--json]")
	}
	if *depth != 1 && *depth != 2 {
		return fmt.Errorf("invalid --depth %d (expected 1 or 2)", *depth)
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	params := url.Values{}
	params.Set("q", query)
	params.Set("seeds", strconv.Itoa(*seeds))
	params.Set("limit", strconv.Itoa(*limit))
	params.Set("depth", strconv.Itoa(*depth))
	if *section != "" {
		params.Set("section", *section)
	}
	if *docType != "" {
		params.Set("type", *docType)
	}
	addBrains(params, parseBrainList(*brain, cfg))

	var resp deepSearchResponse
	if err := client.GetJSON("/api/vault/deep-search", params, &resp); err != nil {
		return printFriendlyErr(err)
	}

	if *jsonOut {
		return printJSON(&resp)
	}
	printDeepSearchResults(&resp)
	return nil
}

func printDeepSearchResults(resp *deepSearchResponse) {
	if resp.Count == 0 {
		fmt.Fprintln(os.Stderr, "No results.")
		return
	}
	fmt.Fprintf(os.Stderr, "GraphRAG: %d seed(s), %d result(s), %d graph edge(s) at depth %d\n",
		resp.Seeds, resp.Count, len(resp.Graph.Edges), resp.Depth)
	for _, r := range resp.Results {
		marker := "S" // seed
		if r.Source == "graph" {
			marker = fmt.Sprintf("G%d", r.Hop) // graph neighbor with hop distance
		}
		title := r.Title
		if title == "" {
			title = r.Path
		}
		fmt.Printf("%s\t%.3f\t%s\t%s\n", marker, r.Score, r.Path, oneLine(title))
		if r.Source == "graph" && len(r.LinkedFrom) > 0 {
			fmt.Printf("\t\t\t  linked from: %s\n", strings.Join(r.LinkedFrom, ", "))
		}
	}
}

// Semantic runs the semantic (vector or hybrid) search command.
func Semantic(args []string) error {
	fs := flag.NewFlagSet("semantic", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name, comma-separated list ('a,b'), or 'all' (defaults to active brain)")
	mode := fs.String("mode", "hybrid", "search mode: hybrid|vector")
	limit := fs.Int("limit", 20, "maximum results to return")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	setLeafUsage(fs, leafHelp{
		Summary: "Semantic search (hybrid FTS+vector by default).",
		Usage:   "aju semantic <query> [--brain <name|a,b|all>] [--mode hybrid|vector] [--limit N] [--json]",
		Long:    "Use --mode vector for pure-embedding similarity; hybrid wins on most mixed queries.",
		Examples: []string{
			"aju semantic \"how did we think about NDC vs GDS\"",
			"aju semantic ndc --brain all --mode vector",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	query := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if query == "" {
		return errors.New("usage: aju semantic <query> [--brain <name|a,b|all>] [--mode hybrid|vector] [--limit <n>] [--json]")
	}
	if *mode != "hybrid" && *mode != "vector" {
		return fmt.Errorf("invalid --mode %q (expected hybrid or vector)", *mode)
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	params := url.Values{}
	params.Set("q", query)
	params.Set("mode", *mode)
	params.Set("limit", strconv.Itoa(*limit))
	addBrains(params, parseBrainList(*brain, cfg))

	var resp searchResponse
	if err := client.GetJSON("/api/vault/semantic-search", params, &resp); err != nil {
		return printFriendlyErr(err)
	}

	if *jsonOut {
		return printJSON(&resp)
	}
	printSearchResults(resp.Results)
	return nil
}

func printSearchResults(results []searchResult) {
	if len(results) == 0 {
		fmt.Fprintln(os.Stderr, "No results.")
		return
	}
	// Only show the brain column when the response mixes brains — keeps
	// single-brain output identical to the previous format.
	showBrain := false
	if len(results) > 0 {
		first := results[0].Brain
		for _, r := range results[1:] {
			if r.Brain != first {
				showBrain = true
				break
			}
		}
	}
	for _, r := range results {
		score := r.RRFScore
		if score == 0 {
			score = r.Similarity
		}
		if score == 0 {
			score = r.Rank
		}
		snippet := oneLine(r.Snippet)
		if snippet == "" {
			snippet = r.Title
		}
		if showBrain {
			fmt.Printf("%s\t%.4f\t[%s] %s\n", r.Path, score, r.Brain, snippet)
		} else {
			fmt.Printf("%s\t%.4f\t%s\n", r.Path, score, snippet)
		}
	}
}

func oneLine(s string) string {
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\t", " ")
	// Collapse runs of spaces.
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	return strings.TrimSpace(s)
}

// printJSON pretty-prints any value as JSON to stdout.
func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
