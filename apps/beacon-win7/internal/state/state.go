// Package state mirrors src/beacon/state-store.adapter.ts and the home
// directory rule in src/beacon/entry.adapter.ts. The files are shared with
// the Bun beacon, so a machine pairs once whichever beacon runs.
package state

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// State records which Kanna this machine is paired with.
type State struct {
	KannaURL string `json:"kannaUrl"`
	BeaconID string `json:"beaconId"`
}

// Home is KANNA_BEACON_HOME when it is set (even to an empty string, as
// `??` does in TypeScript), else ".kanna-beacon" under the user's home.
func Home() (string, error) {
	if home, ok := os.LookupEnv("KANNA_BEACON_HOME"); ok {
		return home, nil
	}
	user, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(user, ".kanna-beacon"), nil
}

// KeyPath is the private key file inside home.
func KeyPath(home string) string { return filepath.Join(home, "key.der") }

// Path is the state file inside home.
func Path(home string) string { return filepath.Join(home, "state.json") }

// Load returns nil on any defect: a missing, unreadable, malformed or
// incomplete file all read as "not paired".
func Load(path string) *State {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var object map[string]any
	if err := json.Unmarshal(data, &object); err != nil {
		return nil
	}
	kannaURL, urlOK := object["kannaUrl"].(string)
	beaconID, idOK := object["beaconId"].(string)
	if !urlOK || !idOK {
		return nil
	}
	return &State{KannaURL: kannaURL, BeaconID: beaconID}
}

// Save writes the state compactly, creating parent directories; a new file
// is created with mode 0600.
func Save(path string, value State) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o777); err != nil {
		return err
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

// Clear deletes the state file; a missing file is not an error.
func Clear(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}
