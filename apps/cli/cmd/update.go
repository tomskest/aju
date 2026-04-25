package cmd

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/tomskest/aju/cli/internal/manifest"
)

// selfUpdateTimeout bounds a single HTTP download within UpdateSelf.
const selfUpdateTimeout = 5 * time.Minute

// UpdateSelf is the implementation of `aju update` (with no args). It fetches
// the manifest, compares the running version, downloads the new binary,
// verifies it against the release checksums, and atomically replaces the
// currently running executable.
func UpdateSelf(args []string) error {
	fs := flag.NewFlagSet("update", flag.ContinueOnError)
	force := fs.Bool("force", false, "reinstall even if already on the latest version")
	installBase := fs.String("install-base", envOr("AJU_INSTALL_BASE", manifest.DefaultInstallBase), "override install worker URL")
	setLeafUsage(fs, leafHelp{
		Summary: "Update the CLI binary in place. Verified against release checksums.",
		Usage:   "aju update [--force] [--install-base <url>]",
		Long: `Fetches the manifest, compares against the running version, downloads
the platform-matched binary, verifies its SHA-256 against the published
checksums, and atomically replaces the running executable.

Note: 'aju update <path>' (with a positional note path) dispatches instead
to the vault-update command. This block is only for the self-update form.`,
		Examples: []string{
			"aju update",
			"aju update --force",
		},
	})
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	current := CurrentVersion
	m, err := manifest.Fetch(*installBase)
	if err != nil {
		return fmt.Errorf("fetch manifest: %w", err)
	}
	if m.LatestVersion == "" || m.LatestVersion == "unknown" {
		return errors.New("manifest did not report a latest version (upstream release metadata is unavailable)")
	}

	if !*force && manifest.CompareVersions(current, m.LatestVersion) >= 0 {
		fmt.Printf("Already up to date (%s).\n", current)
		return nil
	}

	key := manifest.PlatformKey()
	downloadURL := m.Download[key]
	if downloadURL == "" {
		return fmt.Errorf("no download available for platform %s", key)
	}
	if m.ChecksumsURL == "" {
		return errors.New("manifest is missing checksums_url — refusing to update without verification")
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate current binary: %w", err)
	}
	// Resolve any symlinks so we overwrite the real file, not a symlink.
	if resolved, err := filepath.EvalSymlinks(exePath); err == nil {
		exePath = resolved
	}

	destDir := filepath.Dir(exePath)
	tmp, err := os.CreateTemp(destDir, ".aju-update-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmp.Name()
	// Best-effort cleanup if we fail before the final rename.
	renamed := false
	defer func() {
		_ = tmp.Close()
		if !renamed {
			_ = os.Remove(tmpPath)
		}
	}()

	fmt.Printf("Downloading %s...\n", downloadURL)
	sum, err := downloadAndHash(downloadURL, tmp)
	if err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}

	fmt.Printf("Verifying checksum...\n")
	assetName := path.Base(downloadURL)
	expected, err := fetchExpectedChecksum(m.ChecksumsURL, assetName)
	if err != nil {
		return err
	}
	if !strings.EqualFold(expected, sum) {
		return fmt.Errorf("checksum mismatch for %s (expected %s, got %s)", assetName, expected, sum)
	}

	if err := os.Chmod(tmpPath, 0o755); err != nil {
		return fmt.Errorf("chmod temp binary: %w", err)
	}

	if err := os.Rename(tmpPath, exePath); err != nil {
		return fmt.Errorf("install new binary: %w", err)
	}
	renamed = true

	fmt.Printf("Updated to %s.\n", m.LatestVersion)
	return nil
}

// downloadAndHash streams the body of url into dst while computing its SHA-256.
// Returns the hex digest on success.
func downloadAndHash(url string, dst io.Writer) (string, error) {
	client := &http.Client{Timeout: selfUpdateTimeout}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("build download request: %w", err)
	}
	req.Header.Set("User-Agent", manifest.DefaultUserAgent)
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("download http %d", resp.StatusCode)
	}

	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(dst, h), resp.Body); err != nil {
		return "", fmt.Errorf("write download: %w", err)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// fetchExpectedChecksum downloads the checksums.txt file and returns the
// SHA-256 hex digest for the given asset name.
//
// checksums.txt format (shasum -a 256):
//
//	<hex>  <filename>
//
// We match by filename suffix to tolerate a stray leading "./" or " *" marker.
func fetchExpectedChecksum(url, assetName string) (string, error) {
	client := &http.Client{Timeout: manifest.FetchTimeout}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("build checksums request: %w", err)
	}
	req.Header.Set("User-Agent", manifest.DefaultUserAgent)
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch checksums: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("checksums http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read checksums: %w", err)
	}

	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := fields[len(fields)-1]
		// Strip a shasum BSD-style "*" marker or a "./" prefix.
		name = strings.TrimPrefix(name, "*")
		name = strings.TrimPrefix(name, "./")
		if name == assetName {
			return fields[0], nil
		}
	}
	return "", fmt.Errorf("no checksum entry for %s", assetName)
}

// envOr returns os.Getenv(key) if set, else fallback.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
