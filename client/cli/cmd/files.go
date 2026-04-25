package cmd

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tomskest/aju/client/cli/internal/httpx"
)

// fileEntry mirrors an entry in GET /api/vault/files/list.
type fileEntry struct {
	ID        string   `json:"id"`
	S3Key     string   `json:"s3Key"`
	Filename  string   `json:"filename"`
	MimeType  string   `json:"mimeType"`
	SizeBytes int64    `json:"sizeBytes"`
	Category  string   `json:"category,omitempty"`
	Tags      []string `json:"tags,omitempty"`
	CreatedAt string   `json:"createdAt,omitempty"`
}

type filesListResp struct {
	Files []fileEntry `json:"files"`
}

// filesReadResp is a superset of the three /api/vault/files/read modes. The
// server populates the fields relevant to the requested mode.
type filesReadResp struct {
	// metadata mode
	ID        string   `json:"id,omitempty"`
	S3Key     string   `json:"s3Key,omitempty"`
	Filename  string   `json:"filename,omitempty"`
	MimeType  string   `json:"mimeType,omitempty"`
	SizeBytes int64    `json:"sizeBytes,omitempty"`
	Category  string   `json:"category,omitempty"`
	Tags      []string `json:"tags,omitempty"`
	CreatedAt string   `json:"createdAt,omitempty"`
	// url mode
	URL string `json:"url,omitempty"`
	// content mode
	Content string `json:"content,omitempty"` // base64
}

// presignUploadResp mirrors POST /api/vault/files/presign-upload.
type presignUploadResp struct {
	UploadURL string            `json:"uploadUrl"`
	Key       string            `json:"key"`
	Fields    map[string]string `json:"fields,omitempty"`
}

// confirmUploadResp mirrors POST /api/vault/files/confirm-upload.
type confirmUploadResp struct {
	Key      string `json:"key,omitempty"`
	Filename string `json:"filename,omitempty"`
	ID       string `json:"id,omitempty"`
}

// uploadResp mirrors POST /api/vault/files/upload (multipart fallback).
type uploadResp struct {
	Key      string `json:"key,omitempty"`
	Filename string `json:"filename,omitempty"`
	ID       string `json:"id,omitempty"`
}

// FilesList implements `aju files list`.
func FilesList(args []string) error {
	fs := flag.NewFlagSet("files list", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	category := fs.String("category", "", "filter by category")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	setLeafUsage(fs, leafHelp{
		Summary: "List files in a brain. Tab-separated: key, filename, mime, size, createdAt.",
		Usage:   "aju files list [--brain <name>] [--category <c>] [--json]",
		Examples: []string{
			"aju files list",
			"aju files list --category receipts",
			"aju files list --brain Acme --json",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	params := url.Values{}
	addBrain(params, resolveBrainFlag(*brain, cfg))
	if *category != "" {
		params.Set("category", *category)
	}

	var resp filesListResp
	if err := client.GetJSON("/api/vault/files/list", params, &resp); err != nil {
		return printFriendlyErr(err)
	}

	if *jsonOut {
		return printJSON(&resp)
	}
	if len(resp.Files) == 0 {
		fmt.Fprintln(os.Stderr, "No files.")
		return nil
	}
	for _, f := range resp.Files {
		fmt.Printf("%s\t%s\t%s\t%d\t%s\n",
			f.S3Key,
			f.Filename,
			f.MimeType,
			f.SizeBytes,
			f.CreatedAt,
		)
	}
	return nil
}

// FilesRead implements `aju files read <key> [--mode metadata|url|content]`.
func FilesRead(args []string) error {
	fs := flag.NewFlagSet("files read", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	mode := fs.String("mode", "metadata", "metadata|url|content")
	output := fs.String("output", "", "write content to file (--mode content)")
	jsonOut := fs.Bool("json", false, "print raw JSON (metadata mode only)")
	setLeafUsage(fs, leafHelp{
		Summary: "Read a file's metadata, fetch a presigned URL, or download its content.",
		Usage:   "aju files read <key> [--mode metadata|url|content] [--output <path>] [--brain <name>] [--json]",
		Long: `--mode metadata (default): print mime, size, category, tags, createdAt.
--mode url: print a short-lived presigned GET URL.
--mode content: stream the raw bytes to stdout, or to --output <path>.`,
		Examples: []string{
			"aju files read img/2026/04-22.png",
			"aju files read img/2026/04-22.png --mode url",
			"aju files read img/2026/04-22.png --mode content --output /tmp/out.png",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju files read <key> [--brain <name>] [--mode metadata|url|content] [--output <path>]")
	}
	key := fs.Arg(0)
	if *mode != "metadata" && *mode != "url" && *mode != "content" {
		return fmt.Errorf("invalid --mode %q (expected metadata, url, or content)", *mode)
	}

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	params := url.Values{}
	params.Set("key", key)
	params.Set("mode", *mode)
	addBrain(params, resolveBrainFlag(*brain, cfg))

	var resp filesReadResp
	if err := client.GetJSON("/api/vault/files/read", params, &resp); err != nil {
		return printFriendlyErr(err)
	}

	switch *mode {
	case "url":
		if resp.URL == "" {
			return errors.New("server returned empty url")
		}
		fmt.Println(resp.URL)
		return nil
	case "content":
		if resp.Content == "" {
			return errors.New("server returned empty content")
		}
		decoded, err := base64.StdEncoding.DecodeString(resp.Content)
		if err != nil {
			return fmt.Errorf("decode base64 content: %w", err)
		}
		if *output != "" {
			if err := os.WriteFile(*output, decoded, 0o600); err != nil {
				return fmt.Errorf("write %s: %w", *output, err)
			}
			fmt.Fprintf(os.Stderr, "Wrote %d bytes to %s\n", len(decoded), *output)
			return nil
		}
		if _, err := os.Stdout.Write(decoded); err != nil {
			return fmt.Errorf("write stdout: %w", err)
		}
		return nil
	default: // metadata
		if *jsonOut {
			return printJSON(&resp)
		}
		fmt.Printf("Key:       %s\n", resp.S3Key)
		fmt.Printf("Filename:  %s\n", resp.Filename)
		fmt.Printf("Mime:      %s\n", resp.MimeType)
		fmt.Printf("Size:      %d bytes\n", resp.SizeBytes)
		if resp.Category != "" {
			fmt.Printf("Category:  %s\n", resp.Category)
		}
		if len(resp.Tags) > 0 {
			fmt.Printf("Tags:      %s\n", strings.Join(resp.Tags, ","))
		}
		if resp.CreatedAt != "" {
			fmt.Printf("Created:   %s\n", resp.CreatedAt)
		}
		return nil
	}
}

// FilesUpload implements `aju files upload <local-path>`. Prefers the
// presign → PUT → confirm flow; falls back to multipart upload if the
// presign endpoint isn't available (HTTP 404).
func FilesUpload(args []string) error {
	fs := flag.NewFlagSet("files upload", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	category := fs.String("category", "", "file category")
	tagsCSV := fs.String("tags", "", "comma-separated tags")
	setLeafUsage(fs, leafHelp{
		Summary: "Upload a local file to a brain. Prefers presign → PUT → confirm.",
		Usage:   "aju files upload <local-path> [--brain <name>] [--category <c>] [--tags a,b,c]",
		Long:    "Falls back to a multipart POST when the server lacks the presign endpoint.",
		Examples: []string{
			"aju files upload ./diagram.png",
			"aju files upload ./diagram.png --category diagrams --tags design,q2",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju files upload <local-path> [--brain <name>] [--category <c>] [--tags a,b,c]")
	}
	localPath := fs.Arg(0)

	info, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("stat %s: %w", localPath, err)
	}
	if info.IsDir() {
		return fmt.Errorf("%s is a directory", localPath)
	}

	filename := filepath.Base(localPath)
	mimeType := detectMime(localPath)
	size := info.Size()

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}
	brainName := resolveBrainFlag(*brain, cfg)
	tags := parseTags(*tagsCSV)

	// Try presign → PUT → confirm first.
	key, err := tryPresignFlow(client, brainName, localPath, filename, mimeType, size, *category, tags)
	if err == nil {
		fmt.Printf("Uploaded %s (key: %s)\n", filename, key)
		return nil
	}
	// Only fall back for 404; other errors (auth, network, 5xx) surface.
	if !isNotFound(err) {
		return printFriendlyErr(err)
	}

	// Fallback: multipart POST /api/vault/files/upload.
	key, err = multipartUpload(client, brainName, localPath, filename, mimeType, *category, tags)
	if err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf("Uploaded %s (key: %s)\n", filename, key)
	return nil
}

// FilesDelete implements `aju files delete <key>` with a confirmation prompt.
func FilesDelete(args []string) error {
	fs := flag.NewFlagSet("files delete", flag.ContinueOnError)
	brain := fs.String("brain", "", "brain name (defaults to active brain)")
	yes := fs.Bool("yes", false, "skip confirmation prompt")
	setLeafUsage(fs, leafHelp{
		Summary: "Delete a file from a brain by key. Requires --yes on non-TTY stdin.",
		Usage:   "aju files delete <key> [--brain <name>] [--yes]",
		Examples: []string{
			"aju files delete img/2026/04-22.png",
			"aju files delete img/2026/04-22.png --yes",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: aju files delete <key> [--brain <name>] [--yes]")
	}
	key := fs.Arg(0)

	client, cfg, err := loadAuthedClient()
	if err != nil {
		return err
	}

	if !*yes {
		if !isStdinTTY() {
			return errors.New("refusing to delete without --yes when stdin is not a TTY")
		}
		fmt.Printf("Delete %s? [y/N] ", key)
		ans, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		ans = strings.ToLower(strings.TrimSpace(ans))
		if ans != "y" && ans != "yes" {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return errors.New("aborted")
		}
	}

	body := map[string]any{"key": key}
	target := "/api/vault/files/delete"
	if b := resolveBrainFlag(*brain, cfg); b != "" {
		body["brain"] = b
		target += "?brain=" + url.QueryEscape(b)
	}

	var resp map[string]any
	if err := client.PostJSON(target, body, &resp); err != nil {
		return printFriendlyErr(err)
	}
	fmt.Printf("Deleted %s\n", key)
	return nil
}

// tryPresignFlow attempts presign → PUT → confirm. Returns the final s3 key
// on success. Callers check isNotFound on error to decide whether to fall
// back to the multipart upload path.
func tryPresignFlow(client *httpx.Client, brain, localPath, filename, mimeType string, size int64, category string, tags []string) (string, error) {
	presignBody := map[string]any{
		"filename":  filename,
		"mimeType":  mimeType,
		"sizeBytes": size,
	}
	presignTarget := "/api/vault/files/presign-upload"
	if brain != "" {
		presignBody["brain"] = brain
		presignTarget += "?brain=" + url.QueryEscape(brain)
	}

	var presign presignUploadResp
	if err := client.PostJSON(presignTarget, presignBody, &presign); err != nil {
		return "", err
	}
	if presign.UploadURL == "" || presign.Key == "" {
		return "", errors.New("presign response missing uploadUrl or key")
	}

	f, err := os.Open(localPath)
	if err != nil {
		return "", fmt.Errorf("open %s: %w", localPath, err)
	}
	defer f.Close()

	req, err := http.NewRequest(http.MethodPut, presign.UploadURL, f)
	if err != nil {
		return "", fmt.Errorf("build PUT request: %w", err)
	}
	req.ContentLength = size
	req.Header.Set("Content-Type", mimeType)
	for k, v := range presign.Fields {
		req.Header.Set(k, v)
	}

	// 5 minute timeout — uploads can be large.
	httpClient := &http.Client{Timeout: 5 * time.Minute}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("PUT upload: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		snippet := strings.TrimSpace(string(raw))
		if len(snippet) > 256 {
			snippet = snippet[:256] + "..."
		}
		return "", fmt.Errorf("PUT upload failed (%d): %s", resp.StatusCode, snippet)
	}

	confirmBody := map[string]any{
		"key":       presign.Key,
		"filename":  filename,
		"mimeType":  mimeType,
		"sizeBytes": size,
	}
	if category != "" {
		confirmBody["category"] = category
	}
	if len(tags) > 0 {
		confirmBody["tags"] = tags
	}
	confirmTarget := "/api/vault/files/confirm-upload"
	if brain != "" {
		confirmBody["brain"] = brain
		confirmTarget += "?brain=" + url.QueryEscape(brain)
	}

	var confirm confirmUploadResp
	if err := client.PostJSON(confirmTarget, confirmBody, &confirm); err != nil {
		return "", err
	}
	if confirm.Key != "" {
		return confirm.Key, nil
	}
	return presign.Key, nil
}

// multipartUpload posts the file to /api/vault/files/upload as multipart form
// data. Used as a fallback when the presign endpoint isn't available.
func multipartUpload(client *httpx.Client, brain, localPath, filename, mimeType, category string, tags []string) (string, error) {
	f, err := os.Open(localPath)
	if err != nil {
		return "", fmt.Errorf("open %s: %w", localPath, err)
	}
	defer f.Close()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	// file part — set Content-Type explicitly on the part header.
	hdr := make(textproto.MIMEHeader)
	hdr.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	hdr.Set("Content-Type", mimeType)
	part, err := w.CreatePart(hdr)
	if err != nil {
		return "", fmt.Errorf("multipart create file part: %w", err)
	}
	if _, err := io.Copy(part, f); err != nil {
		return "", fmt.Errorf("multipart copy file: %w", err)
	}

	if category != "" {
		if err := w.WriteField("category", category); err != nil {
			return "", err
		}
	}
	if len(tags) > 0 {
		if err := w.WriteField("tags", strings.Join(tags, ",")); err != nil {
			return "", err
		}
	}
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("multipart close: %w", err)
	}

	target := client.BaseURL + "/api/vault/files/upload"
	if brain != "" {
		target += "?brain=" + url.QueryEscape(brain)
	}

	req, err := http.NewRequest(http.MethodPost, target, &buf)
	if err != nil {
		return "", fmt.Errorf("build multipart request: %w", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-aju-cli-version", httpx.Version)
	if client.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+client.APIKey)
	}

	resp, err := client.HTTP.Do(req)
	if err != nil {
		return "", &httpx.Error{Kind: httpx.ErrNetwork, Message: fmt.Sprintf("network: %v", err), Err: err}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", &httpx.Error{Kind: httpx.ErrNetwork, Message: fmt.Sprintf("read response: %v", err), Err: err}
	}
	if resp.StatusCode >= 400 {
		snippet := strings.TrimSpace(string(raw))
		if len(snippet) > 256 {
			snippet = snippet[:256] + "..."
		}
		return "", &httpx.Error{
			Kind:    httpx.ErrHTTP,
			Status:  resp.StatusCode,
			Message: fmt.Sprintf("http %d: %s", resp.StatusCode, snippet),
			Body:    snippet,
		}
	}

	var out uploadResp
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			return "", &httpx.Error{Kind: httpx.ErrDecode, Message: fmt.Sprintf("decode response: %v", err), Err: err}
		}
	}
	if out.Key != "" {
		return out.Key, nil
	}
	return "", errors.New("server did not return a key")
}

// parseTags splits a comma-separated tags flag into a trimmed, non-empty slice.
func parseTags(csv string) []string {
	if csv == "" {
		return nil
	}
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// detectMime guesses a MIME type from the file extension; falls back to
// application/octet-stream. We don't sniff contents — the server is the
// source of truth and the client hint is advisory.
func detectMime(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != "" {
		if m := mime.TypeByExtension(ext); m != "" {
			// TypeByExtension may return "text/html; charset=utf-8"; strip
			// params so S3 doesn't reject the signed Content-Type.
			if idx := strings.Index(m, ";"); idx >= 0 {
				return strings.TrimSpace(m[:idx])
			}
			return m
		}
	}
	return "application/octet-stream"
}

// isNotFound reports whether err is an httpx HTTP 404, used to decide whether
// to fall back to the multipart upload path.
func isNotFound(err error) bool {
	var e *httpx.Error
	if !errors.As(err, &e) {
		return false
	}
	return e.Kind == httpx.ErrHTTP && e.Status == http.StatusNotFound
}
