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
)

// documentResponse mirrors the GET /api/vault/document payload. Fields beyond
// content + frontmatter are ignored for display but may be useful later.
type documentResponse struct {
	Path        string         `json:"path"`
	Title       string         `json:"title,omitempty"`
	Section     string         `json:"section,omitempty"`
	Content     string         `json:"content"`
	Frontmatter map[string]any `json:"frontmatter,omitempty"`
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
			"aju read 03-Product/okrs.md --brain Crewpoint",
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
	return nil
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
			"aju browse 06-Sales --brain Crewpoint",
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
	return writeDoc("create", args, "/api/vault/create")
}

// UpdateNote implements the vault-update variant (not the self-update stub).
// main.go dispatches to this when `update` has a path arg.
func UpdateNote(args []string) error {
	return writeDoc("update", args, "/api/vault/update")
}

func writeDoc(op string, args []string, endpoint string) error {
	fs := flag.NewFlagSet(op, flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	verb := "Create"
	if op == "update" {
		verb = "Update"
	}
	setLeafUsage(fs, leafHelp{
		Summary: fmt.Sprintf("%s a note. Content is read from stdin.", verb),
		Usage:   fmt.Sprintf("aju %s <path> [--brain <name>]", op),
		Long:    "Pipe content into stdin; running without a pipe is a user error and is rejected with a hint.",
		Examples: []string{
			fmt.Sprintf("echo '# Hello' | aju %s notes/hello.md", op),
			fmt.Sprintf("cat draft.md | aju %s drafts/draft.md --brain Crewpoint", op),
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return fmt.Errorf("usage: aju %s <path> [--brain <name>] (content via stdin)", op)
	}
	path := fs.Arg(0)

	content, err := readStdinContent(op)
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
	if b := resolveBrainFlag(*brain, cfg); b != "" {
		body["brain"] = b
	}
	// brain also goes on the query string — that's what the server consults.
	target := endpoint
	if b := resolveBrainFlag(*brain, cfg); b != "" {
		target += "?brain=" + url.QueryEscape(b)
	}

	var resp map[string]any
	if err := client.PostJSON(target, body, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if op == "create" {
		fmt.Printf("Created %s\n", path)
	} else {
		fmt.Printf("Updated %s\n", path)
	}
	return nil
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
