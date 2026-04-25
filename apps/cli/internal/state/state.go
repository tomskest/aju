// Package state reads and writes the CLI state file at ~/.aju/state.json.
package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/tomskest/aju/cli/internal/config"
)

// State holds persisted runtime state outside of user configuration.
type State struct {
	LastManifestCheck   string   `json:"last_manifest_check,omitempty"`
	SeenAnnouncementIDs []string `json:"seen_announcement_ids,omitempty"`
}

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
