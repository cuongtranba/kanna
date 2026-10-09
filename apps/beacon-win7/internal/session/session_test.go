package session_test

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/fsops"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/keystore"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/session"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transfer"
)

const helperEnv = "KANNA_BEACON_SESSION_HELPER"

// TestMain lets the test binary double as the program an exec request runs.
func TestMain(m *testing.M) {
	if os.Getenv(helperEnv) == "" {
		os.Exit(m.Run())
	}
	switch os.Args[1] {
	case "say":
		os.Stdout.WriteString(os.Args[2])
	case "wait-for":
		os.Stdout.WriteString("started")
		for {
			if _, err := os.Stat(os.Args[2]); err == nil {
				break
			}
			time.Sleep(5 * time.Millisecond)
		}
	case "create":
		_ = os.WriteFile(os.Args[2], nil, 0o644)
		os.Stdout.WriteString("created")
	}
	os.Exit(0)
}

type memoryTransport struct {
	mu             sync.Mutex
	changed        chan struct{}
	sent           []protocol.Frame
	frameListeners []func(protocol.Frame)
	closeListeners []func()
	closed         bool
}

func newMemoryTransport() *memoryTransport {
	return &memoryTransport{changed: make(chan struct{}, 1)}
}

func (m *memoryTransport) Send(frame protocol.Frame) {
	m.mu.Lock()
	m.sent = append(m.sent, frame)
	m.mu.Unlock()
	select {
	case m.changed <- struct{}{}:
	default:
	}
}

func (m *memoryTransport) OnFrame(listener func(protocol.Frame)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.frameListeners = append(m.frameListeners, listener)
}

func (m *memoryTransport) OnClose(listener func()) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closeListeners = append(m.closeListeners, listener)
}

func (m *memoryTransport) Close() {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return
	}
	m.closed = true
	listeners := m.closeListeners
	m.mu.Unlock()
	for _, listener := range listeners {
		listener()
	}
}

func (m *memoryTransport) push(frame protocol.Frame) {
	m.mu.Lock()
	listeners := append([]func(protocol.Frame){}, m.frameListeners...)
	m.mu.Unlock()
	for _, listener := range listeners {
		listener(frame)
	}
}

func (m *memoryTransport) frames() []protocol.Frame {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]protocol.Frame{}, m.sent...)
}

func (m *memoryTransport) reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = nil
}

// waitFor blocks until done holds over the sent frames, waking on every send.
func (m *memoryTransport) waitFor(t *testing.T, what string, done func([]protocol.Frame) bool) []protocol.Frame {
	t.Helper()
	deadline := time.After(20 * time.Second)
	for {
		frames := m.frames()
		if done(frames) {
			return frames
		}
		select {
		case <-m.changed:
		case <-deadline:
			t.Fatalf("timed out waiting for %s; sent %#v", what, frames)
		}
	}
}

func hasExit(id string) func([]protocol.Frame) bool {
	return func(frames []protocol.Frame) bool {
		return indexOf(frames, func(f protocol.Frame) bool {
			exit, ok := f.(protocol.Exit)
			return ok && exit.ID == id
		}) >= 0
	}
}

func hasReply(id string) func([]protocol.Frame) bool {
	return func(frames []protocol.Frame) bool {
		return indexOf(frames, func(f protocol.Frame) bool {
			switch typed := f.(type) {
			case protocol.Result:
				return typed.ID == id
			case protocol.ErrorFrame:
				return typed.ID == id
			case protocol.Exit:
				return typed.ID == id
			}
			return false
		}) >= 0
	}
}

func indexOf(frames []protocol.Frame, match func(protocol.Frame) bool) int {
	for index, frame := range frames {
		if match(frame) {
			return index
		}
	}
	return -1
}

type harness struct {
	transport *memoryTransport
	session   *session.Session
	keys      *keystore.Store
	root      string
	mu        sync.Mutex
	scopes    []protocol.Scope
	refusals  []string
	tooOld    []protocol.Incompatible
}

func readyScope(root string) protocol.Scope {
	return protocol.Scope{
		Exec:             true,
		ReadRoots:        []string{root},
		PerCallTimeoutMs: 20000,
		OutputByteCap:    1000000,
		MaxConcurrent:    2,
	}
}

func start(t *testing.T) *harness {
	t.Helper()
	return startWithTransfer(t, nil)
}

func startWithTransfer(t *testing.T, transferer *transfer.Transferer) *harness {
	t.Helper()
	root, err := fsops.Realpath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	keys, err := keystore.Open(filepath.Join(t.TempDir(), "key.der"))
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{transport: newMemoryTransport(), keys: keys, root: root}
	h.session = session.New(session.Deps{
		BeaconID:      "b1",
		BeaconVersion: "0.1.0",
		OS:            protocol.OSWindows,
		Transport:     h.transport,
		Signer:        keys,
		FS:            fsops.New(func() []string { return []string{root} }),
		Transfer:      transferer,
		OnScope: func(scope protocol.Scope) {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.scopes = append(h.scopes, scope)
		},
		OnRefused: func(reason string) {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.refusals = append(h.refusals, reason)
		},
		OnIncompatible: func(frame protocol.Incompatible) {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.tooOld = append(h.tooOld, frame)
		},
	})
	h.session.Start()
	return h
}

func (h *harness) ready(scope protocol.Scope, serverProtocol *float64) {
	h.transport.push(protocol.Challenge{Nonce: "n1"})
	h.transport.push(protocol.Ready{Scope: scope, ProtocolVersion: serverProtocol})
	h.transport.reset()
}

func two() *float64 {
	value := 2.0
	return &value
}

func self(t *testing.T) string {
	t.Helper()
	t.Setenv(helperEnv, "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return exe
}

func TestAnnouncesItselfWithAHelloOnStart(t *testing.T) {
	h := start(t)
	want := protocol.Hello{BeaconID: "b1", ProtocolVersion: 3, BeaconVersion: "0.1.0", OS: protocol.OSWindows}
	if frames := h.transport.frames(); len(frames) != 1 || frames[0] != want {
		t.Fatalf("sent %#v, want only %#v", frames, want)
	}
}

func TestAnswersAChallengeWithTheSignedNonce(t *testing.T) {
	h := start(t)
	h.transport.push(protocol.Challenge{Nonce: "abc"})
	frames := h.transport.frames()
	auth, ok := frames[1].(protocol.Auth)
	if !ok {
		t.Fatalf("second frame = %#v", frames[1])
	}
	spki, _ := base64.StdEncoding.DecodeString(h.keys.PublicKeySPKIBase64())
	public, err := x509.ParsePKIXPublicKey(spki)
	if err != nil {
		t.Fatal(err)
	}
	signature, _ := base64.StdEncoding.DecodeString(auth.Signature)
	if !ed25519.Verify(public.(ed25519.PublicKey), []byte("abc"), signature) {
		t.Fatal("the auth signature does not verify for the nonce")
	}
}

func TestReturnsTheFSResultForAReadAfterReady(t *testing.T) {
	h := start(t)
	h.ready(readyScope(h.root), nil)
	if err := os.WriteFile(filepath.Join(h.root, "a.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.transport.push(protocol.RequestFrame{ID: "r1", Request: protocol.Request{Op: protocol.OpRead, Path: filepath.Join(h.root, "a.txt"), Limit: 10}})
	frames := h.transport.waitFor(t, "the read result", hasReply("r1"))
	want := protocol.Result{ID: "r1", Result: fsops.ReadResult{Content: "hi", TotalSize: 2}}
	if len(frames) != 1 || frames[0] != want {
		t.Fatalf("sent %#v, want %#v", frames, want)
	}
}

func TestReportsAScopeViolationAsAnErrorFrame(t *testing.T) {
	h := start(t)
	h.ready(readyScope(h.root), nil)
	outside := filepath.Join(filepath.Dir(h.root), "elsewhere.txt")
	h.transport.push(protocol.RequestFrame{ID: "r2", Request: protocol.Request{Op: protocol.OpStat, Path: outside}})
	frames := h.transport.waitFor(t, "the error", hasReply("r2"))
	want := protocol.ErrorFrame{ID: "r2", Message: "path is outside the permitted read roots: " + outside}
	if len(frames) != 1 || frames[0] != want {
		t.Fatalf("sent %#v, want %#v", frames, want)
	}
}

func TestStreamsExecOutputAndThenTheExitCode(t *testing.T) {
	h := start(t)
	exe := self(t)
	h.ready(readyScope(h.root), nil)
	h.transport.push(protocol.RequestFrame{ID: "r3", Request: protocol.Request{Op: protocol.OpExec, Cmd: exe, Args: []string{"say", "hello world"}}})
	frames := h.transport.waitFor(t, "the exit", hasExit("r3"))
	var out strings.Builder
	for _, frame := range frames[:len(frames)-1] {
		chunk, ok := frame.(protocol.Stdout)
		if !ok || chunk.ID != "r3" {
			t.Fatalf("unexpected frame before the exit: %#v", frame)
		}
		out.WriteString(chunk.Chunk)
	}
	if out.String() != "hello world" || frames[len(frames)-1] != (protocol.Exit{ID: "r3", Code: 0}) {
		t.Fatalf("sent %#v", frames)
	}
}

func TestRefusesExecWithoutRunningItWhenTheScopeForbidsExec(t *testing.T) {
	h := start(t)
	exe := self(t)
	scope := readyScope(h.root)
	scope.Exec = false
	h.ready(scope, nil)
	marker := filepath.Join(h.root, "ran")
	h.transport.push(protocol.RequestFrame{ID: "r4", Request: protocol.Request{Op: protocol.OpExec, Cmd: exe, Args: []string{"create", marker}}})
	h.transport.push(protocol.RequestFrame{ID: "r5", Request: protocol.Request{Op: protocol.OpScript, Body: "echo hi"}})
	frames := h.transport.waitFor(t, "both refusals", func(f []protocol.Frame) bool { return hasReply("r4")(f) && hasReply("r5")(f) })
	for _, id := range []string{"r4", "r5"} {
		if indexOf(frames, func(f protocol.Frame) bool { return f == protocol.ErrorFrame{ID: id, Message: "exec not permitted"} }) < 0 {
			t.Fatalf("%s was not refused: %#v", id, frames)
		}
	}
	if _, err := os.Stat(marker); err == nil {
		t.Fatal("the refused command ran")
	}
}

func TestIgnoresRequestsThatArriveBeforeTheHandshakeCompletes(t *testing.T) {
	h := start(t)
	h.transport.reset()
	h.transport.push(protocol.RequestFrame{ID: "r5", Request: protocol.Request{Op: protocol.OpStat, Path: h.root}})
	h.transport.push(protocol.Ping{})
	h.transport.push(protocol.Challenge{Nonce: "n"})
	h.transport.push(protocol.RequestFrame{ID: "r6", Request: protocol.Request{Op: protocol.OpStat, Path: h.root}})
	frames := h.transport.frames()
	if len(frames) != 1 {
		t.Fatalf("sent %#v, want only the auth", frames)
	}
	if _, ok := frames[0].(protocol.Auth); !ok {
		t.Fatalf("sent %#v", frames)
	}
}

func TestQueuesRequestsBeyondMaxConcurrentUntilASlotFrees(t *testing.T) {
	h := start(t)
	exe := self(t)
	scope := readyScope(h.root)
	scope.MaxConcurrent = 1
	h.ready(scope, nil)
	flag := filepath.Join(h.root, "flag")
	h.transport.push(protocol.RequestFrame{ID: "a", Request: protocol.Request{Op: protocol.OpExec, Cmd: exe, Args: []string{"wait-for", flag}}})
	h.transport.push(protocol.RequestFrame{ID: "b", Request: protocol.Request{Op: protocol.OpExec, Cmd: exe, Args: []string{"create", flag}}})
	h.transport.waitFor(t, "a to start", func(frames []protocol.Frame) bool {
		return indexOf(frames, func(f protocol.Frame) bool { return f == protocol.Stdout{ID: "a", Chunk: "started"} }) >= 0
	})
	if err := os.WriteFile(flag, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	frames := h.transport.waitFor(t, "both exits", func(f []protocol.Frame) bool { return hasExit("a")(f) && hasExit("b")(f) })
	exitA := indexOf(frames, func(f protocol.Frame) bool { return f == protocol.Exit{ID: "a", Code: 0} })
	firstB := indexOf(frames, func(f protocol.Frame) bool {
		out, ok := f.(protocol.Stdout)
		return ok && out.ID == "b"
	})
	if exitA < 0 || firstB < exitA {
		t.Fatalf("b ran before a finished: %#v", frames)
	}
}

func TestRunsRequestsSideBySideUpToMaxConcurrent(t *testing.T) {
	h := start(t)
	exe := self(t)
	h.ready(readyScope(h.root), nil)
	flag := filepath.Join(h.root, "flag")
	h.transport.push(protocol.RequestFrame{ID: "a", Request: protocol.Request{Op: protocol.OpExec, Cmd: exe, Args: []string{"wait-for", flag}}})
	h.transport.push(protocol.RequestFrame{ID: "b", Request: protocol.Request{Op: protocol.OpExec, Cmd: exe, Args: []string{"create", flag}}})
	h.transport.waitFor(t, "both exits", func(f []protocol.Frame) bool { return hasExit("a")(f) && hasExit("b")(f) })
}

func TestAScopeFrameFromTheServerReplacesTheGrantedScope(t *testing.T) {
	h := start(t)
	exe := self(t)
	scope := readyScope(h.root)
	scope.Exec = false
	h.ready(scope, two())
	widened := readyScope(h.root)
	h.transport.push(protocol.ScopeFrame{Scope: widened})
	h.transport.push(protocol.RequestFrame{ID: "r6", Request: protocol.Request{Op: protocol.OpExec, Cmd: exe, Args: []string{"say", "ok"}}})
	h.transport.waitFor(t, "the exec to run", hasExit("r6"))
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.scopes) != 2 || h.scopes[0].Exec || !h.scopes[1].Exec {
		t.Fatalf("scopes seen: %#v", h.scopes)
	}
}

func TestAnswersAPingOnlyOnceReady(t *testing.T) {
	h := start(t)
	h.ready(readyScope(h.root), two())
	h.transport.push(protocol.Ping{})
	if frames := h.transport.frames(); len(frames) != 1 || frames[0] != (protocol.Pong{}) {
		t.Fatalf("sent %#v", frames)
	}
}

func TestAScopeChangeAndAnUnpairAreSentOnlyToAServerThatSpeaksScopeSync(t *testing.T) {
	modern := start(t)
	modern.ready(readyScope(modern.root), two())
	exec := true
	if !modern.session.RequestScopeChange(protocol.ScopeChange{Exec: &exec}) || !modern.session.RequestUnpair() {
		t.Fatal("a scope-sync server must accept both requests")
	}
	if frames := modern.transport.frames(); len(frames) != 2 || frames[1] != (protocol.Unpair{}) {
		t.Fatalf("sent %#v", frames)
	}
	legacy := start(t)
	legacy.ready(readyScope(legacy.root), nil)
	if legacy.session.RequestScopeChange(protocol.ScopeChange{Exec: &exec}) || legacy.session.RequestUnpair() {
		t.Fatal("a server that predates scope sync must not be sent either request")
	}
	if frames := legacy.transport.frames(); len(frames) != 0 {
		t.Fatalf("sent %#v", frames)
	}
	early := start(t)
	if early.session.RequestUnpair() {
		t.Fatal("an unpair before ready must not be sent")
	}
}

func TestARefusalBeforeTheChallengeIsReportedAndTheTransportClosed(t *testing.T) {
	h := start(t)
	h.transport.push(protocol.Refused{Reason: protocol.RefusalUnknownBeacon})
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.refusals) != 1 || h.refusals[0] != protocol.RefusalUnknownBeacon || !h.transport.closed {
		t.Fatalf("refusals %v, closed %v", h.refusals, h.transport.closed)
	}
}

func TestAnIncompatibleServerIsReportedAndTheTransportClosed(t *testing.T) {
	h := start(t)
	h.transport.push(protocol.Incompatible{MinSupported: 9})
	h.transport.push(protocol.Refused{Reason: protocol.RefusalDisabled})
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.tooOld) != 1 || h.tooOld[0].MinSupported != 9 || !h.transport.closed || len(h.refusals) != 0 {
		t.Fatalf("incompatible %v, refusals %v, closed %v", h.tooOld, h.refusals, h.transport.closed)
	}
}

func TestServesADownloadRequestAndRepliesWithPathBytesAndSha256(t *testing.T) {
	content := []byte("workbook bytes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tk" || r.Header.Get("Range") != "bytes=0-13" {
			http.Error(w, "unexpected request", http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(content)
	}))
	defer server.Close()
	var h *harness
	h = startWithTransfer(t, transfer.New(transfer.Config{
		BaseURL:     server.URL,
		ContainRead: func(path string) (string, error) { return path, nil },
		WriteRoots:  func() []string { return []string{h.root} },
		Client:      server.Client(),
	}))
	scope := readyScope(h.root)
	scope.WriteRoots = []string{h.root}
	h.ready(scope, nil)
	sum := sha256.Sum256(content)
	digest := hex.EncodeToString(sum[:])
	destination := filepath.Join(h.root, "book.xlsx")

	h.transport.push(protocol.RequestFrame{ID: "d1", Request: protocol.Request{
		Op: protocol.OpDownload, Path: destination, Ticket: "tk", Size: float64(len(content)), Sha256: digest,
	}})

	frames := h.transport.waitFor(t, "the download reply", hasReply("d1"))
	want := protocol.Result{ID: "d1", Result: transfer.Result{Path: destination, Bytes: int64(len(content)), SHA256: digest}}
	if len(frames) != 1 || frames[0] != want {
		t.Fatalf("sent %#v, want %#v", frames, want)
	}
	encoded, err := protocol.Encode(frames[0])
	if err != nil || !strings.Contains(string(encoded), `"result":{"path":`) || !strings.Contains(string(encoded), `"bytes":14,"sha256":"`+digest+`"`) {
		t.Fatalf("result frame encodes as %s (%v)", encoded, err)
	}
}
