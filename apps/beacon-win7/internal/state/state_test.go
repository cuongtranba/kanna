package state_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/state"
)

func TestSaveLoadAndClearRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "state.json")
	if got := state.Load(path); got != nil {
		t.Fatalf("missing file loaded as %+v", got)
	}
	want := state.State{KannaURL: "https://kanna.example", BeaconID: "b-9"}
	if err := state.Save(path, want); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"kannaUrl":"https://kanna.example","beaconId":"b-9"}` {
		t.Fatalf("state file is %s", data)
	}
	if got := state.Load(path); got == nil || *got != want {
		t.Fatalf("Load = %+v, want %+v", got, want)
	}
	if err := state.Clear(path); err != nil {
		t.Fatal(err)
	}
	if err := state.Clear(path); err != nil {
		t.Fatalf("clearing a missing file failed: %v", err)
	}
	if got := state.Load(path); got != nil {
		t.Fatalf("cleared state loaded as %+v", got)
	}
}

func TestLoadTreatsEveryDefectAsUnpaired(t *testing.T) {
	for _, content := range []string{``, `not json`, `[]`, `{"kannaUrl":"x"}`, `{"kannaUrl":"x","beaconId":3}`, `null`} {
		path := filepath.Join(t.TempDir(), "state.json")
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := state.Load(path); got != nil {
			t.Fatalf("Load(%q) = %+v, want nil", content, got)
		}
	}
}

func TestHomeHonoursTheEnvironmentOverride(t *testing.T) {
	t.Setenv("KANNA_BEACON_HOME", "/somewhere/else")
	home, err := state.Home()
	if err != nil || home != "/somewhere/else" {
		t.Fatalf("Home() = %q, %v", home, err)
	}
}
