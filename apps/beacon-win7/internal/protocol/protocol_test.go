package protocol_test

import (
	"testing"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
)

func TestEncodePutsKindFirstAndNeverEmitsNullOptionals(t *testing.T) {
	cases := []struct {
		name  string
		frame protocol.Frame
		want  string
	}{
		{
			name:  "hello keeps the TypeScript key order",
			frame: protocol.Hello{BeaconID: "b1", ProtocolVersion: 2, BeaconVersion: "1.0.0", OS: protocol.OSWindows},
			want:  `{"kind":"hello","beaconId":"b1","protocolVersion":2,"beaconVersion":"1.0.0","os":"windows"}`,
		},
		{name: "auth", frame: protocol.Auth{Signature: "s=="}, want: `{"kind":"auth","signature":"s=="}`},
		{name: "unpair has no other keys", frame: protocol.Unpair{}, want: `{"kind":"unpair"}`},
		{name: "pong", frame: protocol.Pong{}, want: `{"kind":"pong"}`},
		{name: "result null is still emitted", frame: protocol.Result{ID: "r1"}, want: `{"kind":"result","id":"r1","result":null}`},
		{name: "exit", frame: protocol.Exit{ID: "r1", Code: 124}, want: `{"kind":"exit","id":"r1","code":124}`},
		{
			name:  "html characters are not escaped",
			frame: protocol.Stdout{ID: "r1", Chunk: "<a & b>"},
			want:  `{"kind":"stdout","id":"r1","chunk":"<a & b>"}`,
		},
		{
			name:  "set-scope omits absent fields",
			frame: protocol.SetScope{Change: protocol.ScopeChange{Exec: boolPtr(true)}},
			want:  `{"kind":"set-scope","change":{"exec":true}}`,
		},
		{
			name:  "set-scope keeps an empty folder list",
			frame: protocol.SetScope{Change: protocol.ScopeChange{ReadRoots: &[]string{}}},
			want:  `{"kind":"set-scope","change":{"readRoots":[]}}`,
		},
		{
			name:  "a scope with nil lists encodes arrays",
			frame: protocol.ScopeFrame{Scope: protocol.Scope{MaxConcurrent: 1}},
			want:  `{"kind":"scope","scope":{"exec":false,"execAllowlist":[],"autoRunScripts":false,"trustedScriptHashes":[],"readRoots":[],"writeRoots":[],"perCallTimeoutMs":0,"outputByteCap":0,"maxConcurrent":1}}`,
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got, err := protocol.Encode(tc.frame)
			if err != nil {
				t.Fatalf("Encode: %v", err)
			}
			if string(got) != tc.want {
				t.Fatalf("Encode = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestParseFrameRejectsMalformedJSON(t *testing.T) {
	for _, raw := range []string{``, `{`, `{"kind":"ping"} {"kind":"ping"}`, `{"kind":"ping"}x`} {
		if _, ok := protocol.ParseFrame([]byte(raw)); ok {
			t.Fatalf("ParseFrame(%q) accepted malformed JSON", raw)
		}
	}
}

func TestSupportedProtocolWindow(t *testing.T) {
	if !protocol.IsSupportedProtocol(protocol.MinBeaconProtocol) || !protocol.IsSupportedProtocol(protocol.BeaconProtocolVersion) {
		t.Fatal("the supported window must include both ends")
	}
	if protocol.IsSupportedProtocol(protocol.MinBeaconProtocol-1) || protocol.IsSupportedProtocol(protocol.BeaconProtocolVersion+1) {
		t.Fatal("versions outside the window must be refused")
	}
}

func boolPtr(value bool) *bool { return &value }
