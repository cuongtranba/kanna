package runner_test

import (
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/keystore"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/runner"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/state"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transport"
)

type greeting struct {
	kind            string
	reason          string
	protocolVersion *float64
}

var (
	two     = 2.0
	ready2  = greeting{kind: "ready", protocolVersion: &two}
	ready1  = greeting{kind: "ready"}
	silent  = greeting{kind: "silent"}
	granted = protocol.Scope{ReadRoots: []string{"/home/me"}, MaxConcurrent: 2, PerCallTimeoutMs: 1000, OutputByteCap: 1000}
)

// fakeConnection plays the server side of one connection in memory.
type fakeConnection struct {
	mu             sync.Mutex
	greeting       greeting
	sent           []protocol.Frame
	frameListeners []func(protocol.Frame)
	closeListeners []func()
	closed         bool
	closedByBeacon bool
}

func (c *fakeConnection) Send(frame protocol.Frame) {
	c.mu.Lock()
	c.sent = append(c.sent, frame)
	c.mu.Unlock()
	switch frame.(type) {
	case protocol.Hello:
		switch c.greeting.kind {
		case "refused":
			c.push(protocol.Refused{Reason: c.greeting.reason})
		case "incompatible":
			url := "https://dl.example"
			c.push(protocol.Incompatible{MinSupported: 9, DownloadURL: &url})
		case "ready":
			c.push(protocol.Challenge{Nonce: "n"})
		}
	case protocol.Auth:
		if c.greeting.kind == "ready" {
			c.push(protocol.Ready{Scope: granted, ProtocolVersion: c.greeting.protocolVersion})
		}
	}
}

func (c *fakeConnection) OnFrame(listener func(protocol.Frame)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.frameListeners = append(c.frameListeners, listener)
}

func (c *fakeConnection) OnClose(listener func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closeListeners = append(c.closeListeners, listener)
}

func (c *fakeConnection) Close() {
	c.mu.Lock()
	c.closedByBeacon = true
	c.mu.Unlock()
	c.drop()
}

func (c *fakeConnection) push(frame protocol.Frame) {
	c.mu.Lock()
	listeners := append([]func(protocol.Frame){}, c.frameListeners...)
	c.mu.Unlock()
	for _, listener := range listeners {
		listener(frame)
	}
}

func (c *fakeConnection) drop() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	listeners := c.closeListeners
	c.mu.Unlock()
	for _, listener := range listeners {
		listener()
	}
}

func (c *fakeConnection) wasClosedByBeacon() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closedByBeacon
}

type fakeServer struct {
	mu          sync.Mutex
	greetings   []greeting
	connections []*fakeConnection
	urls        []string
}

func (s *fakeServer) open(url string) transport.Transport {
	s.mu.Lock()
	defer s.mu.Unlock()
	index := len(s.connections)
	if index >= len(s.greetings) {
		index = len(s.greetings) - 1
	}
	connection := &fakeConnection{greeting: s.greetings[index]}
	s.connections = append(s.connections, connection)
	s.urls = append(s.urls, url)
	return connection
}

func (s *fakeServer) connection(index int) *fakeConnection {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.connections[index]
}

func (s *fakeServer) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.connections)
}

// clock hands out timers the test fires by hand.
type clock struct {
	mu      sync.Mutex
	delays  []time.Duration
	pending []chan time.Time
}

func (c *clock) after(delay time.Duration) <-chan time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	timer := make(chan time.Time, 1)
	c.delays = append(c.delays, delay)
	c.pending = append(c.pending, timer)
	return timer
}

func (c *clock) fireAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, timer := range c.pending {
		timer <- time.Time{}
	}
	c.pending = nil
}

var epoch = time.Unix(50, 0)

type harness struct {
	runner  *runner.Runner
	server  *fakeServer
	clock   *clock
	changed chan struct{}
}

func newHarness(t *testing.T, greetings ...greeting) *harness {
	t.Helper()
	keys, err := keystore.Open(filepath.Join(t.TempDir(), "key.der"))
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{server: &fakeServer{greetings: greetings}, clock: &clock{}, changed: make(chan struct{}, 1)}
	h.runner = runner.New(runner.Deps{
		State:         state.State{KannaURL: "https://kanna.example", BeaconID: "b1"},
		OS:            protocol.OSWindows,
		BeaconVersion: "0.2.0",
		Signer:        keys,
		OpenTransport: h.server.open,
		After:         h.clock.after,
		Now:           func() time.Time { return epoch },
	})
	h.runner.Subscribe(func(runner.Snapshot) {
		select {
		case h.changed <- struct{}{}:
		default:
		}
	})
	return h
}

func (h *harness) waitFor(t *testing.T, what string, done func(runner.Snapshot) bool) runner.Snapshot {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		snapshot := h.runner.Snapshot()
		if done(snapshot) {
			return snapshot
		}
		select {
		case <-h.changed:
		case <-deadline:
			t.Fatalf("timed out waiting for %s; status %+v", what, snapshot.Status)
		}
	}
}

func phase(name string) func(runner.Snapshot) bool {
	return func(s runner.Snapshot) bool { return s.Status.Phase == name }
}

func (h *harness) run() <-chan string {
	exit := make(chan string, 1)
	go func() { exit <- h.runner.Run() }()
	return exit
}

func awaitExit(t *testing.T, exit <-chan string) string {
	t.Helper()
	select {
	case reason := <-exit:
		return reason
	case <-time.After(10 * time.Second):
		t.Fatal("Run never returned")
		return ""
	}
}

func TestSocketURLAndBackoff(t *testing.T) {
	if got := runner.SocketURL("http://localhost:3210"); got != "ws://localhost:3210/beacon" {
		t.Fatalf("SocketURL = %s", got)
	}
	if got := runner.SocketURL("https://kanna.example/base//"); got != "wss://kanna.example/base/beacon" {
		t.Fatalf("SocketURL = %s", got)
	}
	for attempt, want := range map[int]time.Duration{0: time.Second, 1: time.Second, 2: 2 * time.Second, 3: 4 * time.Second, 5: 16 * time.Second, 6: 30 * time.Second, 40: 30 * time.Second} {
		if got := runner.Backoff(attempt); got != want {
			t.Fatalf("Backoff(%d) = %v, want %v", attempt, got, want)
		}
	}
}

func TestGoesOnlineWithTheGrantedScopeAndKnowsWhetherTheServerTakesScopeChanges(t *testing.T) {
	h := newHarness(t, ready2)
	h.run()
	snapshot := h.waitFor(t, "online", phase(runner.PhaseOnline))
	if h.server.urls[0] != "wss://kanna.example/beacon" || !snapshot.ScopeSync || snapshot.Scope.ReadRoots[0] != "/home/me" {
		t.Fatalf("snapshot %+v, urls %v", snapshot, h.server.urls)
	}
	if !snapshot.Status.Since.Equal(epoch) {
		t.Fatalf("online since %v", snapshot.Status.Since)
	}
	h.runner.Stop()
}

func TestAServerThatPredatesScopeSyncIsOnlineButCannotTakeScopeChanges(t *testing.T) {
	h := newHarness(t, ready1)
	h.run()
	snapshot := h.waitFor(t, "online", phase(runner.PhaseOnline))
	exec := true
	if snapshot.ScopeSync || h.runner.RequestScopeChange(protocol.ScopeChange{Exec: &exec}) {
		t.Fatal("a legacy server must not take scope changes")
	}
	h.runner.Stop()
}

func TestADroppedConnectionIsOfflineWithItsRetryTimeThenReconnects(t *testing.T) {
	h := newHarness(t, ready2)
	h.run()
	h.waitFor(t, "online", phase(runner.PhaseOnline))
	h.server.connection(0).drop()
	offline := h.waitFor(t, "offline", phase(runner.PhaseOffline)).Status
	want := runner.Status{Phase: runner.PhaseOffline, Attempt: 1, RetryAt: epoch.Add(time.Second), Reason: runner.ReasonUnreachable}
	if offline != want {
		t.Fatalf("offline status %+v, want %+v", offline, want)
	}
	h.clock.fireAll()
	h.waitFor(t, "online again", func(s runner.Snapshot) bool { return s.Status.Phase == runner.PhaseOnline && h.server.count() == 2 })
	h.runner.Stop()
}

func TestRepeatedFailuresBackOffExponentially(t *testing.T) {
	h := newHarness(t, silent)
	h.run()
	for attempt := 1; attempt <= 3; attempt++ {
		h.waitFor(t, "connecting", func(s runner.Snapshot) bool { return h.server.count() == attempt })
		h.server.connection(attempt - 1).drop()
		h.waitFor(t, "offline", func(s runner.Snapshot) bool {
			return s.Status.Phase == runner.PhaseOffline && s.Status.Attempt == attempt
		})
		h.clock.fireAll()
	}
	h.clock.mu.Lock()
	delays := append([]time.Duration{}, h.clock.delays...)
	h.clock.mu.Unlock()
	if len(delays) != 3 || delays[0] != time.Second || delays[1] != 2*time.Second || delays[2] != 4*time.Second {
		t.Fatalf("delays %v", delays)
	}
	h.runner.Stop()
}

func TestABeaconKannaNoLongerKnowsStopsForGoodAsRevoked(t *testing.T) {
	h := newHarness(t, greeting{kind: "refused", reason: protocol.RefusalUnknownBeacon})
	if reason := awaitExit(t, h.run()); reason != runner.ExitRevoked {
		t.Fatalf("exit %s", reason)
	}
	if got := h.runner.Snapshot().Status; got.Phase != runner.PhaseRevoked {
		t.Fatalf("status %+v", got)
	}
}

func TestABeaconKannaHasSwitchedOffKeepsRetryingAndSaysWhy(t *testing.T) {
	h := newHarness(t, greeting{kind: "refused", reason: protocol.RefusalDisabled}, ready2)
	h.run()
	offline := h.waitFor(t, "offline", phase(runner.PhaseOffline)).Status
	if offline.Reason != runner.ReasonDisabled || offline.Attempt != 1 {
		t.Fatalf("status %+v", offline)
	}
	h.clock.fireAll()
	h.waitFor(t, "online", phase(runner.PhaseOnline))
	h.runner.Stop()
}

func TestAnIncompatibleServerEndsTheRun(t *testing.T) {
	h := newHarness(t, greeting{kind: "incompatible"})
	if reason := awaitExit(t, h.run()); reason != runner.ExitIncompatible {
		t.Fatalf("exit %s", reason)
	}
	got := h.runner.Snapshot().Status
	if got.Phase != runner.PhaseIncompatible || got.MinSupported != 9 || got.DownloadURL == nil || *got.DownloadURL != "https://dl.example" {
		t.Fatalf("status %+v", got)
	}
}

func TestUnpairAsksTheServerAndEndsTheRunOnceTheServerCloses(t *testing.T) {
	h := newHarness(t, ready2)
	exit := h.run()
	h.waitFor(t, "online", phase(runner.PhaseOnline))
	acknowledged := make(chan bool, 1)
	go func() { acknowledged <- h.runner.Unpair(5 * time.Second) }()
	connection := h.server.connection(0)
	deadline := time.After(10 * time.Second)
	for {
		connection.mu.Lock()
		sentUnpair := len(connection.sent) > 0 && connection.sent[len(connection.sent)-1] == protocol.Unpair{}
		connection.mu.Unlock()
		if sentUnpair {
			break
		}
		select {
		case <-deadline:
			t.Fatal("unpair was never sent")
		default:
			runtime.Gosched()
		}
	}
	connection.drop()
	if !<-acknowledged {
		t.Fatal("unpair was not acknowledged")
	}
	if reason := awaitExit(t, exit); reason != runner.ExitUnpaired {
		t.Fatalf("exit %s", reason)
	}
}

func TestUnpairThatTheServerNeverAnswersClosesAfterTheTimeout(t *testing.T) {
	h := newHarness(t, ready2)
	exit := h.run()
	h.waitFor(t, "online", phase(runner.PhaseOnline))
	acknowledged := make(chan bool, 1)
	go func() { acknowledged <- h.runner.Unpair(5 * time.Second) }()
	for {
		h.clock.mu.Lock()
		armed := len(h.clock.pending) > 0
		h.clock.mu.Unlock()
		if armed {
			break
		}
		runtime.Gosched()
	}
	h.clock.fireAll()
	if <-acknowledged {
		t.Fatal("a silent server must not count as acknowledged")
	}
	if !h.server.connection(0).wasClosedByBeacon() {
		t.Fatal("the beacon must close the connection itself")
	}
	if reason := awaitExit(t, exit); reason != runner.ExitUnpaired {
		t.Fatalf("exit %s", reason)
	}
}

func TestUnpairWhileOfflineReportsThatKannaWasNotTold(t *testing.T) {
	h := newHarness(t, silent)
	h.run()
	h.waitFor(t, "connecting", func(runner.Snapshot) bool { return h.server.count() == 1 })
	if h.runner.Unpair(5 * time.Second) {
		t.Fatal("an unpair before ready must report false")
	}
	h.runner.Stop()
}

func TestAScopeFrameFromKannaUpdatesTheSnapshot(t *testing.T) {
	h := newHarness(t, ready2)
	h.run()
	h.waitFor(t, "online", phase(runner.PhaseOnline))
	widened := granted
	widened.Exec = true
	h.server.connection(0).push(protocol.ScopeFrame{Scope: widened})
	if scope := h.runner.Snapshot().Scope; scope == nil || !scope.Exec {
		t.Fatalf("scope %+v", scope)
	}
	h.runner.Stop()
}

func TestStopEndsTheRun(t *testing.T) {
	h := newHarness(t, ready2)
	exit := h.run()
	h.waitFor(t, "online", phase(runner.PhaseOnline))
	h.runner.Stop()
	if reason := awaitExit(t, exit); reason != runner.ExitStopped {
		t.Fatalf("exit %s", reason)
	}
	if !h.server.connection(0).wasClosedByBeacon() {
		t.Fatal("stop must close the live connection")
	}
}
