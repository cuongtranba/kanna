package cli_test

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/cli"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/fsops"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/pairing"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/runner"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/state"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transport"
)

type logger struct {
	mu    sync.Mutex
	lines []string
}

func (l *logger) log(line string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lines = append(l.lines, line)
}

func (l *logger) text() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Join(l.lines, "\n")
}

type recordedDelays struct {
	mu     sync.Mutex
	delays []time.Duration
}

func (r *recordedDelays) after(delay time.Duration) <-chan time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.delays = append(r.delays, delay)
	fired := make(chan time.Time, 1)
	fired <- time.Time{}
	return fired
}

var fixedNow = time.Unix(1000, 0)

func newDeps(t *testing.T, logs *logger) cli.Deps {
	t.Helper()
	return cli.Deps{
		OS:            protocol.OSWindows,
		Hostname:      "box",
		BeaconVersion: "0.1.0",
		Home:          filepath.Join(t.TempDir(), "home"),
		Pair:          pairing.Pair,
		OpenTransport: func(url string) transport.Transport { return transport.Dial(url) },
		After:         (&recordedDelays{}).after,
		Now:           func() time.Time { return fixedNow },
		Log:           logs.log,
	}
}

func TestParseArgs(t *testing.T) {
	cases := []struct {
		argv []string
		want cli.Command
	}{
		{[]string{"pair", "https://kanna.example/", "abcd-2345"}, cli.Command{Name: "pair", KannaURL: "https://kanna.example", Code: "ABCD2345"}},
		{[]string{"run"}, cli.Command{Name: "run"}},
		{nil, cli.Command{Name: "invalid", Reason: "missing command"}},
		{[]string{"bogus"}, cli.Command{Name: "invalid", Reason: "unknown command: bogus"}},
		{[]string{"pair", "https://kanna.example"}, cli.Command{Name: "invalid", Reason: "pair needs <kanna-url> and <code>"}},
		{[]string{"pair", "a", "b", "c"}, cli.Command{Name: "invalid", Reason: "pair needs <kanna-url> and <code>"}},
		{[]string{"pair", "kanna.example", "CODE"}, cli.Command{Name: "invalid", Reason: "kanna-url must start with http:// or https://"}},
		{[]string{"run", "extra"}, cli.Command{Name: "invalid", Reason: "run takes no arguments"}},
	}
	for _, tc := range cases {
		if got := cli.ParseArgs(tc.argv); got != tc.want {
			t.Errorf("ParseArgs(%q) = %+v, want %+v", tc.argv, got, tc.want)
		}
	}
}

func TestStartedWithNoCommandItPrintsUsageAndPointsAtTheDesktopApp(t *testing.T) {
	var logs logger
	if code := cli.Run(nil, newDeps(t, &logs)); code != 64 {
		t.Fatalf("exit code %d, want 64", code)
	}
	want := "missing command\n" + cli.Usage + "\n" + cli.DesktopAppHint
	if logs.text() != want {
		t.Fatalf("logged %q, want %q", logs.text(), want)
	}
	logs = logger{}
	if code := cli.Run([]string{"bogus"}, newDeps(t, &logs)); code != 64 || logs.text() != "unknown command: bogus\n"+cli.Usage {
		t.Fatalf("exit %d, logged %q", code, logs.text())
	}
}

func TestPairPostsThePublicKeyAndSavesTheReturnedIdentity(t *testing.T) {
	var body string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
		_, _ = io.WriteString(w, `{"ok":true,"beaconId":"b-9"}`)
	}))
	defer server.Close()
	var logs logger
	deps := newDeps(t, &logs)
	if code := cli.Run([]string{"pair", server.URL + "/", "abcd 2345"}, deps); code != 0 {
		t.Fatalf("exit code %d: %s", code, logs.text())
	}
	var sent map[string]string
	if err := json.Unmarshal([]byte(body), &sent); err != nil {
		t.Fatal(err)
	}
	if sent["code"] != "ABCD2345" || sent["label"] != "box" || sent["os"] != "windows" || sent["publicKey"] == "" {
		t.Fatalf("posted %s", body)
	}
	saved := state.Load(state.Path(deps.Home))
	if saved == nil || *saved != (state.State{KannaURL: server.URL, BeaconID: "b-9"}) {
		t.Fatalf("saved %+v", saved)
	}
	if logs.text() != "paired as b-9. Start the beacon with: kanna-beacon run" {
		t.Fatalf("logged %q", logs.text())
	}
}

func TestPairReportsARefusedCodeWithAFailingExitCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = io.WriteString(w, `{"ok":false,"error":"expired"}`)
	}))
	defer server.Close()
	var logs logger
	if code := cli.Run([]string{"pair", server.URL, "CODE"}, newDeps(t, &logs)); code != 1 {
		t.Fatalf("exit code %d", code)
	}
	if logs.text() != "pairing failed: expired" {
		t.Fatalf("logged %q", logs.text())
	}
}

func TestRunRefusesToStartOnAnUnpairedMachine(t *testing.T) {
	var logs logger
	if code := cli.Run([]string{"run"}, newDeps(t, &logs)); code != 1 {
		t.Fatalf("exit code %d", code)
	}
	if logs.text() != "this machine is not paired. Run: kanna-beacon pair <kanna-url> <code>" {
		t.Fatalf("logged %q", logs.text())
	}
}

// beaconServer is a real WebSocket endpoint; script decides what each
// successive connection does.
func beaconServer(t *testing.T, script func(index int, conn *websocket.Conn)) (string, *[]string) {
	t.Helper()
	var mu sync.Mutex
	paths := []string{}
	count := 0
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		mu.Lock()
		index := count
		count++
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		script(index, conn)
	}))
	t.Cleanup(server.Close)
	return server.URL, &paths
}

func readFrame(t *testing.T, conn *websocket.Conn) protocol.Frame {
	t.Helper()
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Errorf("server read: %v", err)
		return nil
	}
	frame, ok := protocol.ParseFrame(data)
	if !ok {
		t.Errorf("beacon sent an invalid frame: %s", data)
	}
	return frame
}

func writeFrame(t *testing.T, conn *websocket.Conn, frame protocol.Frame) {
	t.Helper()
	data, err := protocol.Encode(frame)
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Errorf("server write: %v", err)
	}
}

func pairedDeps(t *testing.T, logs *logger, kannaURL string) cli.Deps {
	t.Helper()
	deps := newDeps(t, logs)
	if err := state.Save(state.Path(deps.Home), state.State{KannaURL: kannaURL, BeaconID: "b-1"}); err != nil {
		t.Fatal(err)
	}
	return deps
}

func TestRunReconnectsAfterADropAndStopsForGoodOnAnIncompatibleServer(t *testing.T) {
	url, paths := beaconServer(t, func(index int, conn *websocket.Conn) {
		readFrame(t, conn)
		if index > 0 {
			download := "https://dl.example"
			writeFrame(t, conn, protocol.Incompatible{MinSupported: 9, DownloadURL: &download})
			_, _, _ = conn.ReadMessage()
		}
	})
	var logs logger
	deps := pairedDeps(t, &logs, url)
	delays := &recordedDelays{}
	deps.After = delays.after
	if code := cli.Run([]string{"run"}, deps); code != 2 {
		t.Fatalf("exit code %d: %s", code, logs.text())
	}
	if len(*paths) != 2 || (*paths)[0] != "/beacon" || (*paths)[1] != "/beacon" {
		t.Fatalf("connected to %v", *paths)
	}
	if len(delays.delays) != 1 || delays.delays[0] != time.Second {
		t.Fatalf("waited %v", delays.delays)
	}
	want := "disconnected; reconnecting in 1000 ms\n" +
		"this beacon is too old for the server (it needs protocol 9 or newer). Download the latest beacon: https://dl.example"
	if logs.text() != want {
		t.Fatalf("logged %q, want %q", logs.text(), want)
	}
}

func TestRunCompletesTheHandshakeServesARequestAndStopsWhenRevoked(t *testing.T) {
	root, err := fsops.Realpath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	var logs logger
	var deps cli.Deps
	served := make(chan string, 1)
	url, _ := beaconServer(t, func(index int, conn *websocket.Conn) {
		hello := readFrame(t, conn)
		if index > 0 {
			writeFrame(t, conn, protocol.Refused{Reason: protocol.RefusalUnknownBeacon})
			_, _, _ = conn.ReadMessage()
			return
		}
		if hello != (protocol.Hello{BeaconID: "b-1", ProtocolVersion: 2, BeaconVersion: "0.1.0", OS: protocol.OSWindows}) {
			t.Errorf("hello = %#v", hello)
		}
		writeFrame(t, conn, protocol.Challenge{Nonce: "nonce-1"})
		auth, _ := readFrame(t, conn).(protocol.Auth)
		der, err := os.ReadFile(state.KeyPath(deps.Home))
		if err != nil {
			t.Error(err)
			return
		}
		parsed, err := x509.ParsePKCS8PrivateKey(der)
		if err != nil {
			t.Error(err)
			return
		}
		signature, _ := base64.StdEncoding.DecodeString(auth.Signature)
		public := parsed.(ed25519.PrivateKey).Public().(ed25519.PublicKey)
		if !ed25519.Verify(public, []byte("nonce-1"), signature) {
			t.Error("auth signature does not verify")
		}
		version := 2.0
		writeFrame(t, conn, protocol.Ready{Scope: protocol.Scope{ReadRoots: []string{root}, MaxConcurrent: 1}, ProtocolVersion: &version})
		writeFrame(t, conn, protocol.RequestFrame{ID: "r1", Request: protocol.Request{Op: protocol.OpRead, Path: filepath.Join(root, "a.txt"), Limit: 100}})
		_, raw, _ := conn.ReadMessage()
		served <- string(raw)
	})
	deps = pairedDeps(t, &logs, url)
	if code := cli.Run([]string{"run"}, deps); code != 1 {
		t.Fatalf("exit code %d: %s", code, logs.text())
	}
	want := `{"kind":"result","id":"r1","result":{"content":"hello","totalSize":5,"truncated":false,"binary":false}}`
	if got := <-served; got != want {
		t.Fatalf("served %s, want %s", got, want)
	}
	text := logs.text()
	if !strings.HasPrefix(text, "connected to "+url+"\n") || !strings.HasSuffix(text, "Kanna no longer knows this beacon. Pair it again: kanna-beacon pair <kanna-url> <code>") {
		t.Fatalf("logged %q", text)
	}
}

func TestDescribeStatus(t *testing.T) {
	now := time.Unix(100, 0)
	cases := []struct {
		status runner.Status
		want   string
	}{
		{runner.Status{Phase: runner.PhaseOnline}, "connected to https://k"},
		{runner.Status{Phase: runner.PhaseOffline, RetryAt: now.Add(2 * time.Second), Reason: runner.ReasonUnreachable}, "disconnected; reconnecting in 2000 ms"},
		{runner.Status{Phase: runner.PhaseOffline, RetryAt: now.Add(-time.Second), Reason: runner.ReasonDisabled}, "Kanna has switched this beacon off; reconnecting in 0 ms"},
		{runner.Status{Phase: runner.PhaseIncompatible, MinSupported: 3}, "this beacon is too old for the server (it needs protocol 3 or newer)."},
		{runner.Status{Phase: runner.PhaseConnecting}, ""},
	}
	for _, tc := range cases {
		if got := cli.DescribeStatus(tc.status, "https://k", now); got != tc.want {
			t.Errorf("DescribeStatus(%+v) = %q, want %q", tc.status, got, tc.want)
		}
	}
}
