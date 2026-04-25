// Package manifest fetches and parses the CLI release manifest served by the
// install worker. The manifest tells the CLI the latest published version,
// the minimum supported version, platform-specific download URLs, and a set
// of in-band announcements to surface to users.
package manifest

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// DefaultInstallBase is the public install worker URL used when the caller
// does not override it (e.g. via the AJU_INSTALL_BASE env var).
const DefaultInstallBase = "https://install.aju.sh"

// DefaultUserAgent is the User-Agent sent with manifest requests.
const DefaultUserAgent = "aju-cli"

// FetchTimeout bounds the manifest round-trip. Kept short so a slow or
// unreachable worker can never block a user-issued command.
const FetchTimeout = 10 * time.Second

// Manifest is the decoded shape of /cli-manifest.json.
type Manifest struct {
	LatestVersion       string            `json:"latest_version"`
	MinSupportedVersion string            `json:"min_supported_version"`
	Download            map[string]string `json:"download"`
	ChecksumsURL        string            `json:"checksums_url"`
	Announcements       []Announcement    `json:"announcements"`
}

// Announcement is a single item in Manifest.Announcements.
// ShowAfter / ShowUntil are ISO-8601 timestamp strings; a missing value means
// "no lower / no upper bound".
type Announcement struct {
	ID          string `json:"id"`
	Title       string `json:"title,omitempty"`
	Body        string `json:"body,omitempty"`
	URL         string `json:"url,omitempty"`
	Priority    string `json:"priority,omitempty"`
	ShowAfter   string `json:"show_after,omitempty"`
	ShowUntil   string `json:"show_until,omitempty"`
	Dismissible bool   `json:"dismissible,omitempty"`
}

// Fetch GETs {installBase}/cli-manifest.json and returns the decoded manifest.
// An empty installBase falls back to DefaultInstallBase.
func Fetch(installBase string) (*Manifest, error) {
	return FetchWithTimeout(installBase, FetchTimeout)
}

// FetchWithTimeout is Fetch but with an explicit timeout. Useful for the
// best-effort pre-dispatch check where we want an even shorter ceiling.
func FetchWithTimeout(installBase string, timeout time.Duration) (*Manifest, error) {
	base := strings.TrimRight(installBase, "/")
	if base == "" {
		base = DefaultInstallBase
	}
	u := base + "/cli-manifest.json"

	client := &http.Client{Timeout: timeout}
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("build manifest request: %w", err)
	}
	req.Header.Set("User-Agent", DefaultUserAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch manifest: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("manifest http %d", resp.StatusCode)
	}

	m := &Manifest{}
	if err := json.Unmarshal(body, m); err != nil {
		return nil, fmt.Errorf("decode manifest: %w", err)
	}
	return m, nil
}

// PlatformKey returns the manifest lookup key for the running platform
// (e.g. "darwin_arm64", "linux_amd64"). The format matches the keys produced
// by the install worker.
func PlatformKey() string {
	return runtime.GOOS + "_" + runtime.GOARCH
}

// CompareVersions returns -1 if a < b, 0 if a == b, +1 if a > b.
//
// Each version is split on "." and the leading numeric components are
// compared component-wise. A non-numeric suffix on either component (e.g.
// "0.1.0-beta" vs "0.1.0") is stripped from the number and compared
// lexicographically between the two versions after the numeric tail is
// exhausted. Missing trailing components compare as zero.
//
// The helper is deliberately small — we don't need full semver range math,
// only ordering of our own release tags. Pre-release strings compare
// lexicographically, which is "good enough" for beta labels.
func CompareVersions(a, b string) int {
	a = strings.TrimPrefix(a, "v")
	b = strings.TrimPrefix(b, "v")

	aParts := strings.SplitN(a, "-", 2)
	bParts := strings.SplitN(b, "-", 2)
	aCore := aParts[0]
	bCore := bParts[0]

	as := strings.Split(aCore, ".")
	bs := strings.Split(bCore, ".")
	n := len(as)
	if len(bs) > n {
		n = len(bs)
	}
	for i := 0; i < n; i++ {
		an := componentInt(as, i)
		bn := componentInt(bs, i)
		if an < bn {
			return -1
		}
		if an > bn {
			return 1
		}
	}

	// Cores are equal — compare pre-release suffixes.
	aPre := ""
	bPre := ""
	if len(aParts) > 1 {
		aPre = aParts[1]
	}
	if len(bParts) > 1 {
		bPre = bParts[1]
	}
	// A version WITHOUT a pre-release is > one WITH (1.0.0 > 1.0.0-beta).
	switch {
	case aPre == "" && bPre == "":
		return 0
	case aPre == "" && bPre != "":
		return 1
	case aPre != "" && bPre == "":
		return -1
	case aPre < bPre:
		return -1
	case aPre > bPre:
		return 1
	default:
		return 0
	}
}

// componentInt parses parts[i] as an int, stripping any trailing non-digit
// characters. Returns 0 for missing components or unparseable prefixes.
func componentInt(parts []string, i int) int {
	if i >= len(parts) {
		return 0
	}
	s := parts[i]
	// Strip trailing non-digits so "0-dev" parses as 0 (shouldn't happen
	// in practice — pre-release is already split off — but be safe).
	end := 0
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0
	}
	n, err := strconv.Atoi(s[:end])
	if err != nil {
		return 0
	}
	return n
}
