package cmd

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/tomskest/aju/client/cli/internal/config"
	"github.com/tomskest/aju/client/cli/internal/httpx"
	"github.com/tomskest/aju/client/cli/internal/state"
)

// documentResponse mirrors the GET /api/vault/document payload. Fields beyond
// content + frontmatter are ignored for display but may be useful later.
type documentResponse struct {
	Path        string         `json:"path"`
	Title       string         `json:"title,omitempty"`
	Section     string         `json:"section,omitempty"`
	Content     string         `json:"content"`
	ContentHash string         `json:"contentHash,omitempty"`
	Frontmatter map[string]any `json:"frontmatter,omitempty"`
}

// updateConflictBody is the structured 409 payload returned by
// /api/vault/update when the supplied baseHash does not match the current
// head. The CLI parses this so the user sees a readable conflict instead
// of a raw HTTP error blob.
type updateConflictBody struct {
	Error       string `json:"error"`
	Message     string `json:"message"`
	HeadHash    string `json:"headHash"`
	HeadContent string `json:"headContent"`
	BaseHash    string `json:"baseHash"`
}

type browseResponse struct {
	Count     int                     `json:"count"`
	Documents []browseResponseDocItem `json:"documents"`
}

type browseResponseDocItem struct {
	Path      string   `json:"path"`
	Title     string   `json:"title,omitempty"`
	Section   string   `json:"section,omitempty"`
	Directory string   `json:"directory,omitempty"`
	DocType   string   `json:"docType,omitempty"`
	DocStatus string   `json:"docStatus,omitempty"`
	Tags      []string `json:"tags,omitempty"`
	WordCount int      `json:"wordCount,omitempty"`
}

// Read implements `aju read <path> [--brain <name>]`.
func Read(args []string) error {
	fs := flag.NewFlagSet("read", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	setLeafUsage(fs, leafHelp{
		Summary: "Read a note (frontmatter + body) from a brain.",
		Usage:   "aju read <path> [--brain <name>]",
		Examples: []string{
			"aju read journal/2026-04-22-morning.md",
			"aju read 03-Product/okrs.md --brain Acme",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju read <path> [--brain <name>]")
	}
	path := fs.Arg(0)

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	params := url.Values{}
	params.Set("path", path)
	addBrain(params, resolveBrainFlag(*brain, cfg))

	var doc documentResponse
	if err := client.GetJSON("/api/vault/document", params, &doc); err != nil {
		return printFriendlyErr(err)
	}

	if len(doc.Frontmatter) > 0 {
		printFrontmatterYAML(doc.Frontmatter)
		fmt.Println("---")
	}
	// Content may already include its own trailing newline — emit as-is.
	fmt.Print(doc.Content)
	if !strings.HasSuffix(doc.Content, "\n") {
		fmt.Println()
	}
	// Surface the head hash on stderr so callers running interactively
	// (or piping body to a file) can capture it for `aju update --base-hash`
	// without polluting stdout. Suppressed under AJU_QUIET.
	if doc.ContentHash != "" && os.Getenv("AJU_QUIET") != "1" {
		fmt.Fprintf(os.Stderr, "head: %s\n", doc.ContentHash)
	}
	// Stash (hash, content) so the next `aju update` of the same path can
	// populate baseHash + baseContent automatically. Cache is keyed by
	// (profile, brain, path) to keep cross-org state isolated.
	if doc.ContentHash != "" {
		stashReadCache(cfg, resolveBrainFlag(*brain, cfg), path, doc.ContentHash, doc.Content)
	}
	return nil
}

// stashReadCache writes the just-read document into ~/.aju/state.json so
// `aju update` can run CAS without explicit flags. Failures are silent —
// the cache is best-effort and never blocks the read.
func stashReadCache(cfg *config.Config, brain, path, hash, content string) {
	st, err := state.Load()
	if err != nil || st == nil {
		return
	}
	profile := ""
	if cfg != nil {
		profile = cfg.Active
	}
	st.PutReadCache(profile, brain, path, hash, content, time.Now().UTC().Format(time.RFC3339))
	_ = state.Save(st)
}

// Browse implements `aju browse <dir> [--brain <name>]`.
func Browse(args []string) error {
	fs := flag.NewFlagSet("browse", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	setLeafUsage(fs, leafHelp{
		Summary: "List notes under a directory. With no <dir>, lists the brain root.",
		Usage:   "aju browse [<dir>] [--brain <name>]",
		Examples: []string{
			"aju browse",
			"aju browse 06-Sales",
			"aju browse 06-Sales --brain Acme",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	dir := ""
	if fs.NArg() >= 1 {
		dir = fs.Arg(0)
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	params := url.Values{}
	if dir != "" {
		params.Set("directory", dir)
	}
	addBrain(params, resolveBrainFlag(*brain, cfg))

	var resp browseResponse
	if err := client.GetJSON("/api/vault/browse", params, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if resp.Count == 0 || len(resp.Documents) == 0 {
		fmt.Fprintln(os.Stderr, "No documents.")
		return nil
	}
	for _, d := range resp.Documents {
		title := d.Title
		if title == "" {
			title = "(untitled)"
		}
		fmt.Printf("%s\t%s\n", d.Path, title)
	}
	return nil
}

// Create implements `aju create <path>` — reads stdin and POSTs to
// /api/vault/create.
func Create(args []string) error {
	fs := flag.NewFlagSet("create", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	setLeafUsage(fs, leafHelp{
		Summary: "Create a note. Content is read from stdin.",
		Usage:   "aju create <path> [--brain <name>]",
		Long:    "Pipe content into stdin; running without a pipe is a user error and is rejected with a hint.",
		Examples: []string{
			"echo '# Hello' | aju create notes/hello.md",
			"cat draft.md | aju create drafts/draft.md --brain Acme",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju create <path> [--brain <name>] (content via stdin)")
	}
	path := fs.Arg(0)

	content, err := readStdinContent("create")
	if err != nil {
		return err
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	body := map[string]any{
		"path":    path,
		"content": content,
		"source":  "aju-cli",
	}
	target := "/api/vault/create"
	if b := resolveBrainFlag(*brain, cfg); b != "" {
		body["brain"] = b
		target += "?brain=" + url.QueryEscape(b)
	}

	var resp map[string]any
	if err := client.PostJSON(target, body, &resp); err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf("Created %s\n", path)
	return nil
}

// UpdateNote implements `aju update <path>` — the vault-note update command.
// main.go dispatches here when `update` has a positional path argument.
// The CLI binary self-update lives at `aju self-update` (cmd.UpdateSelf).
//
// CAS protocol:
//
//   - Pass `--base-hash <hash>` (the head hash printed by `aju read`) to
//     enable the server's compare-and-swap. If another writer has touched
//     the doc since you read it, the server returns 409 and the CLI
//     prints a structured conflict message so you can re-read and retry.
//   - `--force` skips the CAS check entirely (legacy force-write).
//   - If neither flag is set, the server falls back to legacy with a
//     Deprecation header. A future release will require one of the two.
func UpdateNote(args []string) error {
	fs := flag.NewFlagSet("update", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	baseHash := fs.String("base-hash", "", "head hash of the version you're editing (from `aju read`)")
	force := fs.Bool("force", false, "skip the compare-and-swap check (overwrite whatever is there)")
	setLeafUsage(fs, leafHelp{
		Summary: "Update a note. Content is read from stdin.",
		Usage:   "aju update <path> [--base-hash <hash>] [--force] [--brain <name>]",
		Long: `Pipe content into stdin; running without a pipe is a user error and is
rejected with a hint.

The server uses --base-hash to detect concurrent edits. Capture the hash
from a prior 'aju read' (printed to stderr as 'head: <hash>') and pass
it on update. On hash mismatch the server returns 409 with the current
head; re-read, re-apply your edit, and retry.

--force overrides this and writes unconditionally. Without --base-hash
or --force the request falls back to legacy force-write and the server
returns a Deprecation header.`,
		Examples: []string{
			"cat draft.md | aju update notes/hello.md --base-hash 9f3a...",
			"cat draft.md | aju update notes/hello.md --force",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju update <path> [--base-hash <hash>] [--force] [--brain <name>] (content via stdin)")
	}
	path := fs.Arg(0)

	content, err := readStdinContent("update")
	if err != nil {
		return err
	}

	if *baseHash != "" && *force {
		return errors.New("--base-hash and --force are mutually exclusive")
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	resolvedBrain := resolveBrainFlag(*brain, cfg)

	// CAS field resolution. Precedence: explicit --base-hash > read cache
	// > nothing (legacy force-write). --force suppresses the cache lookup.
	effectiveBaseHash := *baseHash
	var effectiveBaseContent string
	if !*force {
		if effectiveBaseHash == "" {
			if st, err := state.Load(); err == nil && st != nil {
				if e, ok := st.LookupReadCache(cfg.Active, resolvedBrain, path); ok {
					effectiveBaseHash = e.Hash
					effectiveBaseContent = e.Content
				}
			}
		}
	}

	body := map[string]any{
		"path":    path,
		"content": content,
		"source":  "aju-cli",
	}
	if effectiveBaseHash != "" {
		body["baseHash"] = effectiveBaseHash
	}
	if effectiveBaseContent != "" {
		body["baseContent"] = effectiveBaseContent
	}
	target := "/api/vault/update"
	if resolvedBrain != "" {
		body["brain"] = resolvedBrain
		target += "?brain=" + url.QueryEscape(resolvedBrain)
	}

	var resp map[string]any
	if err := client.PostJSON(target, body, &resp); err != nil {
		// Surface a structured conflict on 409 so the user sees the
		// current head hash and can retry without grepping the raw body.
		if httpx.IsConflict(err) {
			return printUpdateConflict(err, path)
		}
		return printFriendlyErr(err)
	}
	if merged, _ := resp["merged"].(bool); merged {
		fmt.Printf("Updated %s (auto-merged with concurrent changes)\n", path)
	} else {
		fmt.Printf("Updated %s\n", path)
	}
	// Refresh the cache so a follow-up update of the same doc keeps
	// riding the CAS fast path with the latest head.
	if newHash, ok := resp["contentHash"].(string); ok && newHash != "" {
		if newContent, ok := resp["content"].(string); ok {
			stashReadCache(cfg, resolvedBrain, path, newHash, newContent)
		}
	}
	return nil
}

// printUpdateConflict decodes the 409 body from /api/vault/update and writes
// a readable explanation to stderr. Returns ErrSilent so main.exitWith
// doesn't double-print the underlying httpx.Error.
func printUpdateConflict(err error, path string) error {
	var hErr *httpx.Error
	if !errors.As(err, &hErr) {
		return err
	}
	var body updateConflictBody
	_ = json.Unmarshal([]byte(hErr.Body), &body)

	fmt.Fprintf(os.Stderr, "Conflict: %s has changed since your read.\n", path)
	if body.Message != "" {
		fmt.Fprintf(os.Stderr, "  %s\n", body.Message)
	}
	if body.BaseHash != "" {
		fmt.Fprintf(os.Stderr, "  your base: %s\n", body.BaseHash)
	}
	if body.HeadHash != "" {
		fmt.Fprintf(os.Stderr, "  current:   %s\n", body.HeadHash)
	}
	fmt.Fprintln(os.Stderr, "Run `aju read "+path+"` again, re-apply your edit, then retry with the new --base-hash.")
	return ErrSilent
}

// Delete implements `aju delete <path>` with a confirmation prompt.
func Delete(args []string) error {
	fs := flag.NewFlagSet("delete", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	yes := fs.Bool("yes", false, "skip confirmation prompt")
	setLeafUsage(fs, leafHelp{
		Summary: "Delete a note from a brain. Requires --yes on non-TTY stdin.",
		Usage:   "aju delete <path> [--brain <name>] [--yes]",
		Examples: []string{
			"aju delete drafts/stale.md",
			"aju delete drafts/stale.md --yes",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju delete <path> [--brain <name>] [--yes]")
	}
	path := fs.Arg(0)

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	if !*yes {
		if !isStdinTTY() {
			return errors.New("refusing to delete without --yes when stdin is not a TTY")
		}
		fmt.Printf("Delete %s? [y/N] ", path)
		ans, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		ans = strings.ToLower(strings.TrimSpace(ans))
		if ans != "y" && ans != "yes" {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return errors.New("aborted")
		}
	}

	body := map[string]any{
		"path":   path,
		"source": "aju-cli",
	}
	target := "/api/vault/delete"
	if b := resolveBrainFlag(*brain, cfg); b != "" {
		body["brain"] = b
		target += "?brain=" + url.QueryEscape(b)
	}

	var resp map[string]any
	if err := client.PostJSON(target, body, &resp); err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf("Deleted %s\n", path)
	return nil
}

// readStdinContent drains stdin into a string. Fails if stdin is a TTY with
// no piped content (user likely typed `aju create foo.md` and expected magic).
func readStdinContent(op string) (string, error) {
	if isStdinTTY() {
		return "", fmt.Errorf("no content on stdin — pipe content to `aju %s <path>` (e.g. `echo 'hi' | aju %s foo.md`)", op, op)
	}
	buf, err := io.ReadAll(os.Stdin)
	if err != nil {
		return "", fmt.Errorf("read stdin: %w", err)
	}
	if len(buf) == 0 {
		return "", errors.New("empty content on stdin")
	}
	return string(buf), nil
}

// isStdinTTY reports whether os.Stdin is connected to a terminal. stdlib-only.
func isStdinTTY() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}

// printFrontmatterYAML emits a shallow YAML-ish block for the frontmatter map.
// Good enough for human reading; we're not trying to round-trip.
func printFrontmatterYAML(fm map[string]any) {
	keys := make([]string, 0, len(fm))
	for k := range fm {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := fm[k]
		switch val := v.(type) {
		case string:
			fmt.Printf("%s: %s\n", k, val)
		case []any:
			fmt.Printf("%s:\n", k)
			for _, item := range val {
				fmt.Printf("  - %v\n", item)
			}
		default:
			// Fall back to JSON for nested maps / numbers / bools.
			b, _ := json.Marshal(v)
			fmt.Printf("%s: %s\n", k, string(b))
		}
	}
}
