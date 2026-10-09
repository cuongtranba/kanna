package protocol_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
)

func readFixture(t *testing.T, name string, into any) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "conformance", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	if err := json.Unmarshal(data, into); err != nil {
		t.Fatalf("decode fixture %s: %v", name, err)
	}
}

func plainJSON(t *testing.T, data []byte) any {
	t.Helper()
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatalf("decode %s: %v", data, err)
	}
	return value
}

func TestFrameConformance(t *testing.T) {
	var fixture struct {
		Cases []struct {
			Name     string          `json:"name"`
			Valid    bool            `json:"valid"`
			Frame    json.RawMessage `json:"frame"`
			Expected json.RawMessage `json:"expected"`
		} `json:"cases"`
	}
	readFixture(t, "frames.json", &fixture)
	if len(fixture.Cases) < 50 {
		t.Fatalf("frame fixture has only %d cases", len(fixture.Cases))
	}
	for _, tc := range fixture.Cases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {
			frame, ok := protocol.ParseFrame(tc.Frame)
			if ok != tc.Valid {
				t.Fatalf("ParseFrame(%s) valid = %v, want %v", tc.Frame, ok, tc.Valid)
			}
			if !tc.Valid {
				if frame != nil {
					t.Fatalf("rejected frame returned a value: %#v", frame)
				}
				return
			}
			want := tc.Expected
			if len(want) == 0 {
				want = tc.Frame
			}
			encoded, err := protocol.Encode(frame)
			if err != nil {
				t.Fatalf("Encode: %v", err)
			}
			if got, expected := plainJSON(t, encoded), plainJSON(t, want); !reflect.DeepEqual(got, expected) {
				t.Fatalf("parsed frame encodes as %s, want %s", encoded, want)
			}
		})
	}
}

func TestPathConformance(t *testing.T) {
	var fixture struct {
		Cases []struct {
			Name   string   `json:"name"`
			Target string   `json:"target"`
			Roots  []string `json:"roots"`
			Inside bool     `json:"inside"`
		} `json:"cases"`
	}
	readFixture(t, "paths.json", &fixture)
	for _, tc := range fixture.Cases {
		tc := tc
		t.Run(tc.Name, func(t *testing.T) {
			if got := protocol.IsPathInsideRoots(tc.Target, tc.Roots); got != tc.Inside {
				t.Fatalf("IsPathInsideRoots(%q, %q) = %v, want %v", tc.Target, tc.Roots, got, tc.Inside)
			}
		})
	}
}
