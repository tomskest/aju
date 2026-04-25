// Package config reads and writes the CLI config file at ~/.aju/config.json.
//
// The file is a JSON document with a profile map so one machine can juggle
// multiple (user, org) pairs — useful when the same human belongs to several
// shared organizations and wants `aju search` / MCP calls to route to the
// right tenant database.
//
// Shape (v1):
//
//	{
//	  "defaultProfile": "work",
//	  "profiles": {
//	    "personal": { "server": "...", "key": "aju_live_...", "org": "toomas-lxh5a7" },
//	    "work":     { "key": "aju_live_...", "org": "acme-corp" }
//	  }
//	}
//
// Backward compat: v0 files had top-level `server`/`key`/`brain`/`org` fields
// and no `profiles` map. Those are read as a single profile named "default"
// and rewritten on the next Save.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// DefaultServer is used when a profile does not set a Server URL.
const DefaultServer = "https://aju.sh"

// DefaultProfileName is the profile name used when migrating from v0
// (flat-shape) configs or when the caller mints a profile without naming it.
const DefaultProfileName = "default"

// Profile holds the credentials and defaults for one (user, org) pairing.
type Profile struct {
	Server string `json:"server,omitempty"`
	Key    string `json:"key,omitempty"`
	Brain  string `json:"brain,omitempty"`
	Org    string `json:"org,omitempty"`
}

// Config is the persisted CLI configuration.
type Config struct {
	DefaultProfile string              `json:"defaultProfile,omitempty"`
	Profiles       map[string]*Profile `json:"profiles,omitempty"`

	// Active is the profile the currently-running CLI invocation uses. It is
	// set by `Load` based on $AJU_PROFILE → DefaultProfile → "default" →
	// the sole profile. Not persisted directly; kept on the struct so
	// callers that already hold a *Config can reach both the active profile
	// and the map of all profiles.
	Active string `json:"-"`
}

// --- paths -----------------------------------------------------------------

// Dir returns the absolute path to the ~/.aju directory.
func Dir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".aju"), nil
}

// Path returns the absolute path to the config file.
func Path() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

// EnsureDir creates the ~/.aju directory with 0700 permissions.
func EnsureDir() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create config dir: %w", err)
	}
	return dir, nil
}

// --- on-disk format --------------------------------------------------------

// diskShape is a union of v0 (flat) and v1 (profiles) fields. We read into
// this, then normalize to the in-memory Config below.
type diskShape struct {
	// v1 fields
	DefaultProfile string              `json:"defaultProfile,omitempty"`
	Profiles       map[string]*Profile `json:"profiles,omitempty"`

	// v0 fields — present only on pre-upgrade files. Read and migrated.
	Server string `json:"server,omitempty"`
	Key    string `json:"key,omitempty"`
	Brain  string `json:"brain,omitempty"`
	Org    string `json:"org,omitempty"`
}

// --- load / save -----------------------------------------------------------

// Load reads the config file and resolves the active profile. A missing file
// yields an empty Config whose Active is "default". $AJU_PROFILE overrides
// DefaultProfile when set.
func Load() (*Config, error) {
	p, err := Path()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return newEmpty(), nil
		}
		return nil, fmt.Errorf("read config: %w", err)
	}
	if len(data) == 0 {
		return newEmpty(), nil
	}

	var d diskShape
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	c := &Config{
		DefaultProfile: d.DefaultProfile,
		Profiles:       d.Profiles,
	}
	if c.Profiles == nil {
		c.Profiles = map[string]*Profile{}
	}

	// v0 migration: if the file had any top-level auth fields, fold them
	// into a profile called "default". Don't overwrite an existing
	// "default" profile that already came from v1.
	if d.Server != "" || d.Key != "" || d.Brain != "" || d.Org != "" {
		if _, exists := c.Profiles[DefaultProfileName]; !exists {
			c.Profiles[DefaultProfileName] = &Profile{
				Server: d.Server,
				Key:    d.Key,
				Brain:  d.Brain,
				Org:    d.Org,
			}
		}
		if c.DefaultProfile == "" {
			c.DefaultProfile = DefaultProfileName
		}
	}

	c.Active = resolveActive(c)
	return c, nil
}

// Save writes the config to disk with 0600 permissions. The on-disk shape is
// always v1 — any v0 fields present in a legacy file are dropped on rewrite.
func Save(c *Config) error {
	if _, err := EnsureDir(); err != nil {
		return err
	}
	p, err := Path()
	if err != nil {
		return err
	}
	out := diskShape{
		DefaultProfile: c.DefaultProfile,
		Profiles:       c.Profiles,
	}
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	if err := os.WriteFile(p, data, 0o600); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	return nil
}

// --- profile resolution ---------------------------------------------------

// resolveActive picks the active profile name. Precedence:
//  1. $AJU_PROFILE (env override for one-off invocations)
//  2. Config.DefaultProfile
//  3. "default" (if a profile with that name exists)
//  4. The sole profile, if exactly one is configured
//  5. "default" as a last resort — accessors may return empty strings
func resolveActive(c *Config) string {
	if env := os.Getenv("AJU_PROFILE"); env != "" {
		return env
	}
	if c.DefaultProfile != "" {
		return c.DefaultProfile
	}
	if _, ok := c.Profiles[DefaultProfileName]; ok {
		return DefaultProfileName
	}
	if len(c.Profiles) == 1 {
		for k := range c.Profiles {
			return k
		}
	}
	return DefaultProfileName
}

// SetActive overrides the active profile for this process. Used when the
// user passes `--profile <name>` on the command line.
func (c *Config) SetActive(name string) {
	if name == "" {
		return
	}
	c.Active = name
}

// Profile returns the active profile, creating it if missing.
func (c *Config) Profile() *Profile {
	if c.Profiles == nil {
		c.Profiles = map[string]*Profile{}
	}
	p, ok := c.Profiles[c.Active]
	if !ok {
		p = &Profile{}
		c.Profiles[c.Active] = p
	}
	return p
}

// ProfileNames returns all configured profile names, sorted.
func (c *Config) ProfileNames() []string {
	names := make([]string, 0, len(c.Profiles))
	for k := range c.Profiles {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}

// RemoveProfile deletes a profile. Returns an error if it's the currently
// active one — callers should switch first.
func (c *Config) RemoveProfile(name string) error {
	if name == c.Active {
		return fmt.Errorf("cannot remove the active profile %q — switch first with `aju profiles use <other>`", name)
	}
	if _, ok := c.Profiles[name]; !ok {
		return fmt.Errorf("no profile named %q", name)
	}
	delete(c.Profiles, name)
	if c.DefaultProfile == name {
		c.DefaultProfile = ""
	}
	return nil
}

// --- convenience accessors -------------------------------------------------

// ServerURL returns the active profile's server or the package default.
func (c *Config) ServerURL() string {
	if p := c.Profile(); p != nil && p.Server != "" {
		return p.Server
	}
	return DefaultServer
}

// APIKey returns the active profile's stored API key, or "".
func (c *Config) APIKey() string {
	if p := c.Profile(); p != nil {
		return p.Key
	}
	return ""
}

// BrainDefault returns the active profile's configured default brain.
func (c *Config) BrainDefault() string {
	if p := c.Profile(); p != nil {
		return p.Brain
	}
	return ""
}

// OrgSlug returns the active profile's pinned org slug.
func (c *Config) OrgSlug() string {
	if p := c.Profile(); p != nil {
		return p.Org
	}
	return ""
}

func newEmpty() *Config {
	c := &Config{
		Profiles: map[string]*Profile{},
	}
	c.Active = resolveActive(c)
	return c
}
