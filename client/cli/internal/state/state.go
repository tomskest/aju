// Package state reads and writes the CLI state file at ~/.aju/state.json.
package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/tomskest/aju/client/cli/internal/config"
)

// State holds persisted runtime state outside of user configuration.
type State struct {
	LastManifestCheck   string   `json:"last_manifest_check,omitempty"`
	SeenAnnouncementIDs []string `json:"seen_announcement_ids,omitempty"`

	// ReadCache stashes the (hash, content) of the most recent `aju read`
	// per (profile, brain, path) so a subsequent `aju update` of the same
	// document can populate baseHash + baseContent automatically and ride
	// the compare-and-swap fast path. Capped to ReadCacheMaxEntries via
	// LRU pruning on insert.
	ReadCache []ReadCacheEntry `json:"read_cache,omitempty"`
}

// ReadCacheEntry records one stashed `aju read`. Keyed by Profile+Brain+Path.
type ReadCacheEntry struct {
	Profile  string `json:"profile,omitempty"`
	Brain    string `json:"brain,omitempty"`
	Path     string `json:"path"`
	Hash     string `json:"hash"`
	Content  string `json:"content"`
	StoredAt string `json:"stored_at,omitempty"`
}

// ReadCacheMaxEntries caps the number of entries kept in State.ReadCache.
// LRU prune happens when an insert would exceed this number.
const ReadCacheMaxEntries = 64

// Path returns the absolute path to the state file.
func Path() (string, error) {
	dir, err := config.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "state.json"), nil
}

// Load reads the state file. A missing file is not an error.
func Load() (*State, error) {
	p, err := Path()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &State{}, nil
		}
		return nil, fmt.Errorf("read state: %w", err)
	}
	s := &State{}
	if len(data) == 0 {
		return s, nil
	}
	if err := json.Unmarshal(data, s); err != nil {
		return nil, fmt.Errorf("parse state: %w", err)
	}
	return s, nil
}

// PutReadCache inserts or refreshes a read-cache entry for (profile, brain,
// path). If an existing entry matches the same key, its position is moved
// to the front so least-recently-used entries fall off the end.
func (s *State) PutReadCache(profile, brain, path, hash, content, ts string) {
	// Remove any existing entry for the same key, then prepend.
	out := s.ReadCache[:0]
	for _, e := range s.ReadCache {
		if e.Profile == profile && e.Brain == brain && e.Path == path {
			continue
		}
		out = append(out, e)
	}
	entry := ReadCacheEntry{
		Profile:  profile,
		Brain:    brain,
		Path:     path,
		Hash:     hash,
		Content:  content,
		StoredAt: ts,
	}
	s.ReadCache = append([]ReadCacheEntry{entry}, out...)
	if len(s.ReadCache) > ReadCacheMaxEntries {
		s.ReadCache = s.ReadCache[:ReadCacheMaxEntries]
	}
}

// LookupReadCache returns the most recent cached entry for the given key,
// or false if no entry exists.
func (s *State) LookupReadCache(profile, brain, path string) (ReadCacheEntry, bool) {
	for _, e := range s.ReadCache {
		if e.Profile == profile && e.Brain == brain && e.Path == path {
			return e, true
		}
	}
	return ReadCacheEntry{}, false
}

// Save writes the state to disk with 0600 permissions.
func Save(s *State) error {
	if _, err := config.EnsureDir(); err != nil {
		return err
	}
	p, err := Path()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("encode state: %w", err)
	}
	if err := os.WriteFile(p, data, 0o600); err != nil {
		return fmt.Errorf("write state: %w", err)
	}
	return nil
}
