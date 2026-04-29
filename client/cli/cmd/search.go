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

// validationBlock matches the per-result `validation` field returned by
// the search routes when the validation layer is enabled. Files don't
// carry validation state, so the field is nullable for non-document rows.
type validationBlock struct {
	Status      string `json:"status"`
	Provenance  string `json:"provenance"`
	ValidatedAt string `json:"validatedAt,omitempty"`
	ValidatedBy string `json:"validatedBy,omitempty"`
	StaleByTime bool   `json:"staleByTime,omitempty"`
}

// searchResult matches the shape returned by /api/vault/search and
// /api/vault/semantic-search (superset of both).
type searchResult struct {
	ID         string           `json:"id,omitempty"`
	Path       string           `json:"path"`
	Title      string           `json:"title,omitempty"`
	Section    string           `json:"section,omitempty"`
	DocType    string           `json:"docType,omitempty"`
	DocStatus  string           `json:"docStatus,omitempty"`
	Tags       []string         `json:"tags,omitempty"`
	WordCount  int              `json:"wordCount,omitempty"`
	SourceType string           `json:"sourceType,omitempty"`
	MimeType   string           `json:"mimeType,omitempty"`
	Brain      string           `json:"brain,omitempty"`
	Rank       float64          `json:"rank,omitempty"`
	RRFScore   float64          `json:"rrfScore,omitempty"`
	Similarity float64          `json:"similarity,omitempty"`
	Score      float64          `json:"score,omitempty"`
	Snippet    string           `json:"snippet,omitempty"`
	Validation *validationBlock `json:"validation,omitempty"`
}

type searchResponse struct {
	Query   string         `json:"query"`
	Mode    string         `json:"mode,omitempty"`
	Brains  []string       `json:"brains,omitempty"`
	Count   int            `json:"count"`
	Results []searchResult `json:"results"`
}

// validationFlags wires the four shared validation flags (--facts,
// --include-stale, --include-disqualified, --provenance) onto a flag set
// and returns getter functions that callers invoke after parseFlags. Same
// shape used by search, semantic, and deep-search so the CLI surface stays
// uniform.
type validationFlags struct {
	facts          *bool
	includeStale   *bool
	includeDisq    *bool
	provenance     *string
	showValidation *bool
}

func registerValidationFlags(fs *flag.FlagSet) *validationFlags {
	return &validationFlags{
		facts:          fs.Bool("facts", false, "strict mode: only validated results"),
		includeStale:   fs.Bool("include-stale", true, "include stale results (default true; --include-stale=false to exclude)"),
		includeDisq:    fs.Bool("include-disqualified", false, "include disqualified results (debug / history mode)"),
		provenance:     fs.String("provenance", "", "filter by provenance: human|agent|ingested"),
		showValidation: fs.Bool("show-validation", true, "show validation marker in results (default on)"),
	}
}

// applyValidationParams writes the validation flags into the outgoing
// query string. Defaults match the server (exclude disqualified, keep
// stale) so we only set params when the user has explicitly opted in.
func (v *validationFlags) applyValidationParams(params url.Values) {
	if *v.facts {
		params.Set("facts", "1")
	}
	if !*v.includeStale {
		params.Set("includeStale", "0")
	}
	if *v.includeDisq {
		params.Set("includeDisqualified", "1")
	}
	if p := strings.TrimSpace(*v.provenance); p != "" {
		switch p {
		case "human", "agent", "ingested":
			params.Set("provenance", p)
		}
	}
}

// Search runs the keyword search command.
func Search(args []string) error {
	fs := flag.NewFlagSet("search", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name, comma-separated list ('a,b'), or 'all' (defaults to active brain)")
	limit := fs.Int("limit", 20, "maximum results to return")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	vf := registerValidationFlags(fs)
	setLeafUsage(fs, leafHelp{
		Summary: "Keyword (FTS) search across one or many brains.",
		Usage:   "aju search <query> [--brain <name|a,b|all>] [--limit N] [--json] [--facts] [--provenance human|agent|ingested]",
		Examples: []string{
			"aju search \"NDC parity\"",
			"aju search ndc --brain Personal,Acme",
			"aju search ndc --brain all --limit 50",
			"aju search ndc --facts                # validated only",
			"aju search ndc --provenance human     # exclude agent-authored",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	query := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if query == "" {
		return errors.New("usage: aju search <query> [--brain <name|a,b|all>] [--limit <n>] [--json] [--facts]")
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	params := url.Values{}
	params.Set("q", query)
	params.Set("limit", strconv.Itoa(*limit))
	addBrains(params, parseBrainList(*brain, cfg))
	vf.applyValidationParams(params)

	var resp searchResponse
	if err := client.GetJSON("/api/vault/search", params, &resp); err != nil {
		return printFriendlyErr(err)
	}

	if *jsonOut {
		return printJSON(&resp)
	}
	printSearchResults(resp.Results, *vf.showValidation)
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

// Semantic runs the semantic (vector or hybrid) search command. Also
// reachable via `aju semantic-search` (alias registered in main.go) for
// callers following the spec phrasing.
func Semantic(args []string) error {
	fs := flag.NewFlagSet("semantic", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name, comma-separated list ('a,b'), or 'all' (defaults to active brain)")
	mode := fs.String("mode", "hybrid", "search mode: hybrid|vector")
	limit := fs.Int("limit", 20, "maximum results to return")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	vf := registerValidationFlags(fs)
	setLeafUsage(fs, leafHelp{
		Summary: "Semantic search (hybrid FTS+vector by default).",
		Usage:   "aju semantic <query> [--brain <name|a,b|all>] [--mode hybrid|vector] [--limit N] [--json] [--facts] [--provenance human|agent|ingested]",
		Long:    "Use --mode vector for pure-embedding similarity; hybrid wins on most mixed queries.",
		Examples: []string{
			"aju semantic \"how did we think about NDC vs GDS\"",
			"aju semantic ndc --brain all --mode vector",
			"aju semantic ndc --facts                # validated only",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	query := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if query == "" {
		return errors.New("usage: aju semantic <query> [--brain <name|a,b|all>] [--mode hybrid|vector] [--limit <n>] [--json] [--facts]")
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
	vf.applyValidationParams(params)

	var resp searchResponse
	if err := client.GetJSON("/api/vault/semantic-search", params, &resp); err != nil {
		return printFriendlyErr(err)
	}

	if *jsonOut {
		return printJSON(&resp)
	}
	printSearchResults(resp.Results, *vf.showValidation)
	return nil
}

// validationMarker returns a single-character glyph for the result's
// validation state. Stays in the leftmost column so it's easy to scan in
// terminal output.
//
//	V validated · S stale · D disqualified · ~ stale-by-time · · unvalidated/none
func validationMarker(v *validationBlock) string {
	if v == nil {
		return " "
	}
	switch v.Status {
	case "validated":
		if v.StaleByTime {
			return "~" // validated but past half-life
		}
		return "V"
	case "stale":
		return "S"
	case "disqualified":
		return "D"
	default:
		return "·"
	}
}

func printSearchResults(results []searchResult, showValidation bool) {
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
		score := r.Score
		if score == 0 {
			score = r.RRFScore
		}
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
		marker := ""
		if showValidation {
			marker = validationMarker(r.Validation) + "\t"
		}
		if showBrain {
			fmt.Printf("%s%s\t%.4f\t[%s] %s\n", marker, r.Path, score, r.Brain, snippet)
		} else {
			fmt.Printf("%s%s\t%.4f\t%s\n", marker, r.Path, score, snippet)
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
