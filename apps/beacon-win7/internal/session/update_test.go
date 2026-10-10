package session_test

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/fsops"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/keystore"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/session"
)

type updateHarness struct {
	transport *memoryTransport
	session   *session.Session
	root      string

	mu             sync.Mutex
	readyVersions  []string
	updateRequests int
}

func startForUpdates(t *testing.T) *updateHarness {
	t.Helper()
	root, err := fsops.Realpath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	keys, err := keystore.Open(filepath.Join(t.TempDir(), "key.der"))
	if err != nil {
		t.Fatal(err)
	}
	h := &updateHarness{transport: newMemoryTransport(), root: root}
	h.session = session.New(session.Deps{
		BeaconID:      "b1",
		BeaconVersion: "1.70.0",
		OS:            protocol.OSWindows,
		Transport:     h.transport,
		Signer:        keys,
		FS:            fsops.New(func() []string { return []string{root} }),
		OnReady: func(_ protocol.Scope, _ float64, serverVersion string) {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.readyVersions = append(h.readyVersions, serverVersion)
		},
		OnUpdateRequested: func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.updateRequests++
		},
	})
	h.session.Start()
	return h
}

func (h *updateHarness) ready(serverProtocol *float64, serverVersion *string) {
	h.transport.push(protocol.Challenge{Nonce: "n1"})
	h.transport.push(protocol.Ready{Scope: readyScope(h.root), ProtocolVersion: serverProtocol, ServerVersion: serverVersion})
	h.transport.reset()
}

func (h *updateHarness) requests() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.updateRequests
}

func float(value float64) *float64 { return &value }

func text(value string) *string { return &value }

func TestReadyCarriesTheServerVersionToTheRunner(t *testing.T) {
	h := startForUpdates(t)
	h.ready(float(4), text("1.71.0"))
	if h.session.ServerVersion() != "1.71.0" {
		t.Fatalf("ServerVersion = %q", h.session.ServerVersion())
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.readyVersions) != 1 || h.readyVersions[0] != "1.71.0" {
		t.Fatalf("OnReady heard %v", h.readyVersions)
	}
}

func TestAServerThatAnnouncesNoVersionLeavesItEmpty(t *testing.T) {
	h := startForUpdates(t)
	h.ready(float(3), nil)
	if h.session.ServerVersion() != "" {
		t.Fatalf("ServerVersion = %q", h.session.ServerVersion())
	}
}

func TestAnIncompatibleServerStillTellsItsVersion(t *testing.T) {
	h := startForUpdates(t)
	h.transport.push(protocol.Incompatible{MinSupported: 5, ServerVersion: text("1.80.0")})
	if h.session.ServerVersion() != "1.80.0" {
		t.Fatalf("ServerVersion = %q", h.session.ServerVersion())
	}
}

func TestAnUpdateFrameReachesTheRunnerOnlyOnceReady(t *testing.T) {
	h := startForUpdates(t)
	h.transport.push(protocol.Update{})
	if h.requests() != 0 {
		t.Fatal("an update before the handshake was acted on")
	}
	h.ready(float(4), text("1.71.0"))
	h.transport.push(protocol.Update{})
	if h.requests() != 1 {
		t.Fatalf("update requests %d", h.requests())
	}
}

func TestUpdateStatusIsSentOnlyToAServerThatSpeaksProtocol4(t *testing.T) {
	failed := "checksum mismatch"
	cases := []struct {
		name           string
		serverProtocol *float64
		wantSent       bool
	}{
		{"protocol 4", float(4), true},
		{"protocol 3", float(3), false},
		{"no protocol version", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := startForUpdates(t)
			if h.session.SendUpdateStatus(protocol.UpdateChecking, "1.71.0", nil) {
				t.Fatal("a status before ready was sent")
			}
			h.ready(tc.serverProtocol, text("1.71.0"))
			if sent := h.session.SendUpdateStatus(protocol.UpdateFailed, "1.71.0", &failed); sent != tc.wantSent {
				t.Fatalf("sent = %v", sent)
			}
			frames := h.transport.frames()
			if !tc.wantSent {
				if len(frames) != 0 {
					t.Fatalf("an old server was sent %#v", frames)
				}
				return
			}
			status, ok := frames[0].(protocol.UpdateStatus)
			if len(frames) != 1 || !ok || status.State != protocol.UpdateFailed || status.Version != "1.71.0" || status.Message == nil || *status.Message != failed {
				t.Fatalf("sent %#v", frames)
			}
		})
	}
}

func TestWaitIdleReturnsOnlyOnceTheRunningRequestFinishes(t *testing.T) {
	h := startForUpdates(t)
	exe := self(t)
	h.ready(float(4), text("1.71.0"))
	if err := h.session.WaitIdle(context.Background()); err != nil {
		t.Fatalf("an idle session did not return at once: %v", err)
	}
	flag := filepath.Join(h.root, "flag")
	h.transport.push(protocol.RequestFrame{ID: "a", Request: protocol.Request{Op: protocol.OpExec, Cmd: exe, Args: []string{"wait-for", flag}}})
	h.transport.waitFor(t, "a to start", func(frames []protocol.Frame) bool {
		return indexOf(frames, func(f protocol.Frame) bool { return f == protocol.Stdout{ID: "a", Chunk: "started"} }) >= 0
	})
	idle := make(chan error, 1)
	go func() { idle <- h.session.WaitIdle(context.Background()) }()
	select {
	case <-idle:
		t.Fatal("WaitIdle returned while a request was running")
	case <-time.After(100 * time.Millisecond):
	}
	if err := os.WriteFile(flag, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-idle:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("WaitIdle never returned")
	}
	if !hasExit("a")(h.transport.frames()) {
		t.Fatal("WaitIdle returned before the request replied")
	}
}

func TestWaitIdleGivesUpWhenItsContextEnds(t *testing.T) {
	h := startForUpdates(t)
	exe := self(t)
	h.ready(float(4), text("1.71.0"))
	flag := filepath.Join(h.root, "flag")
	t.Cleanup(func() {
		_ = os.WriteFile(flag, nil, 0o644)
		h.transport.waitFor(t, "the helper to exit", hasExit("a"))
	})
	h.transport.push(protocol.RequestFrame{ID: "a", Request: protocol.Request{Op: protocol.OpExec, Cmd: exe, Args: []string{"wait-for", flag}}})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := h.session.WaitIdle(ctx); err == nil {
		t.Fatal("WaitIdle ignored its context")
	}
}
