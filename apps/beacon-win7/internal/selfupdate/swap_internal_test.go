package selfupdate

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestASwapThatCannotPlaceTheNewBuildRestoresTheOldOne(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "kanna-beacon.exe")
	staging := exe + StagingSuffix
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(staging, []byte("new"), 0o755); err != nil {
		t.Fatal(err)
	}
	rename = func(from, to string) error {
		if from == staging {
			return errors.New("locked")
		}
		return os.Rename(from, to)
	}
	t.Cleanup(func() { rename = os.Rename })
	if err := swap(exe, staging); err == nil {
		t.Fatal("swap reported success")
	}
	if data, _ := os.ReadFile(exe); string(data) != "old" {
		t.Fatalf("the old build was not restored: %q", data)
	}
	if _, err := os.Stat(exe + OldSuffix); !os.IsNotExist(err) {
		t.Fatalf("the .old copy is still there: %v", err)
	}
}

func TestASwapMovesAsideNextToALockedOldBuild(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "kanna-beacon.exe")
	staging := exe + StagingSuffix
	for path, content := range map[string]string{exe: "current", staging: "new"} {
		if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	locked := exe + OldSuffix
	if err := os.Mkdir(locked, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(locked, "keep"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := swap(exe, staging); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(exe); string(data) != "new" {
		t.Fatalf("installed %q", data)
	}
	matches, _ := filepath.Glob(exe + OldSuffix + "-*")
	if len(matches) != 1 {
		t.Fatalf("old builds %v", matches)
	}
	if data, _ := os.ReadFile(matches[0]); string(data) != "current" {
		t.Fatalf("moved aside %q", data)
	}
}
