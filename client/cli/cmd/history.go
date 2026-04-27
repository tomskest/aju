package cmd

import (
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"strconv"
)

// versionMeta mirrors a single row from /api/vault/document/versions.
// Optional fields use pointer types so a missing field round-trips as nil
// instead of being conflated with the zero value (important for the
// genesis row where parentHash is genuinely null).
type versionMeta struct {
	ID              string  `json:"id"`
	VersionN        int     `json:"versionN"`
	ContentHash     string  `json:"contentHash"`
	ParentHash      *string `json:"parentHash"`
	MergeParentHash *string `json:"mergeParentHash"`
	Source          string  `json:"source"`
	ChangedBy       *string `json:"changedBy"`
	Message         *string `json:"message"`
	CreatedAt       string  `json:"createdAt"`
}

type versionsListResponse struct {
	Path       string        `json:"path"`
	HeadHash   string        `json:"headHash"`
	Direction  string        `json:"direction"`
	Versions   []versionMeta `json:"versions"`
	NextCursor *string       `json:"nextCursor"`
}

type versionDetailResponse struct {
	Path            string  `json:"path"`
	ID              string  `json:"id"`
	VersionN        int     `json:"versionN"`
	Content         string  `json:"content"`
	ContentHash     string  `json:"contentHash"`
	ParentHash      *string `json:"parentHash"`
	MergeParentHash *string `json:"mergeParentHash"`
	Source          string  `json:"source"`
	ChangedBy       *string `json:"changedBy"`
	Message         *string `json:"message"`
	CreatedAt       string  `json:"createdAt"`
}

// History implements `aju history <path>` — show the version history of a
// document. With --version <n> or --hash <hex>, dumps the full content of
// a single historical version.
func History(args []string) error {
	fs := flag.NewFlagSet("history", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	limit := fs.Int("limit", 50, "max versions to list (1-200)")
	direction := fs.String("direction", "newest", "list order: newest|oldest")
	versionN := fs.Int("version", 0, "show full content of a specific version number")
	hash := fs.String("hash", "", "show full content of the version with this content hash")
	setLeafUsage(fs, leafHelp{
		Summary: "Show the version history of a document.",
		Usage:   "aju history <path> [--limit N] [--direction newest|oldest] [--version N | --hash <hex>] [--brain <name>]",
		Long: `Without --version or --hash, prints a one-line-per-commit log:

    v3  9f3a2b...  2026-04-27T12:34:56Z  aju-cli   user@example.com  parent=a1b2c3...
    v2  a1b2c3...  2026-04-27T12:30:01Z  web       user@example.com  parent=000111...
    v1  000111...  2026-04-26T09:00:00Z  backfill                    parent=-

With --version <n> or --hash <hex>, dumps that version's full content
to stdout (frontmatter + body), suitable for redirecting to a file or
piping to a diff tool.`,
		Examples: []string{
			"aju history topics/foo.md",
			"aju history topics/foo.md --limit 10",
			"aju history topics/foo.md --version 2 > old.md",
			"aju history topics/foo.md --hash 9f3a2b...",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju history <path> [flags]")
	}
	path := fs.Arg(0)
	if *versionN != 0 && *hash != "" {
		return errors.New("--version and --hash are mutually exclusive")
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	resolvedBrain := resolveBrainFlag(*brain, cfg)

	// Detail mode: one specific version, dump its content.
	if *versionN != 0 || *hash != "" {
		params := url.Values{}
		params.Set("path", path)
		if *versionN != 0 {
			params.Set("n", strconv.Itoa(*versionN))
		}
		if *hash != "" {
			params.Set("hash", *hash)
		}
		addBrain(params, resolvedBrain)
		var detail versionDetailResponse
		if err := client.GetJSON("/api/vault/document/version", params, &detail); err != nil {
			return printFriendlyErr(err)
		}
		fmt.Print(detail.Content)
		// Surface metadata to stderr, like `aju read` does for head.
		if os.Getenv("AJU_QUIET") != "1" {
			fmt.Fprintf(os.Stderr, "version: v%d\n", detail.VersionN)
			fmt.Fprintf(os.Stderr, "hash:    %s\n", detail.ContentHash)
			fmt.Fprintf(os.Stderr, "at:      %s\n", detail.CreatedAt)
			fmt.Fprintf(os.Stderr, "by:      %s (%s)\n",
				strOrDash(detail.ChangedBy), detail.Source)
		}
		return nil
	}

	// List mode.
	params := url.Values{}
	params.Set("path", path)
	params.Set("limit", strconv.Itoa(*limit))
	params.Set("direction", *direction)
	addBrain(params, resolvedBrain)

	var resp versionsListResponse
	if err := client.GetJSON("/api/vault/document/versions", params, &resp); err != nil {
		return printFriendlyErr(err)
	}
	if len(resp.Versions) == 0 {
		fmt.Fprintln(os.Stderr, "No versions recorded for", path)
		return nil
	}
	for _, v := range resp.Versions {
		marker := ""
		if v.ContentHash == resp.HeadHash {
			marker = " (HEAD)"
		}
		parentTag := "parent=-"
		if v.ParentHash != nil {
			parentTag = "parent=" + truncHash(*v.ParentHash)
		}
		mergeTag := ""
		if v.MergeParentHash != nil {
			mergeTag = " merge=" + truncHash(*v.MergeParentHash)
		}
		fmt.Printf("v%-3d  %s  %s  %-10s  %-22s  %s%s%s\n",
			v.VersionN,
			truncHash(v.ContentHash),
			v.CreatedAt,
			v.Source,
			strOrDash(v.ChangedBy),
			parentTag,
			mergeTag,
			marker,
		)
	}
	if resp.NextCursor != nil && *resp.NextCursor != "" && os.Getenv("AJU_QUIET") != "1" {
		fmt.Fprintf(os.Stderr,
			"more results: rerun with --cursor %s\n", *resp.NextCursor)
	}
	return nil
}

func truncHash(h string) string {
	if len(h) <= 10 {
		return h
	}
	return h[:10] + "…"
}

func strOrDash(p *string) string {
	if p == nil || *p == "" {
		return "-"
	}
	return *p
}
