package runner_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/runner"
)

const helperEnv = "KANNA_BEACON_RUNNER_HELPER"

// TestMain lets the test binary double as a program an exec request runs:
// "wait-for <path>" prints "started" and exits once path exists.
func TestMain(m *testing.M) {
	if os.Getenv(helperEnv) == "" {
		os.Exit(m.Run())
	}
	if len(os.Args) > 2 && os.Args[1] == "wait-for" {
		os.Stdout.WriteString("started")
		for {
			if _, err := os.Stat(os.Args[2]); err == nil {
				break
			}
			time.Sleep(5 * time.Millisecond)
		}
	}
	os.Exit(0)
}

var (
	four  = 4.0
	three = 3.0
)

func version(text string) *string { return &text }

// fakeUpdater stands in for selfupdate.Updater. It reports the same steps,
// and runs beforeSwap where the real one swaps the executable.
type fakeUpdater struct {
	mu       sync.Mutex
	installs []string
	swapped  bool
	fail     error
	hang     bool
}

func (f *fakeUpdater) Install(ctx context.Context, target string, progress func(step string), beforeSwap func() error) error {
	f.mu.Lock()
	f.installs = append(f.installs, target)
	fail, hang := f.fail, f.hang
	f.mu.Unlock()
	progress(protocol.UpdateDownloading)
	if hang {
		<-ctx.Done()
		return ctx.Err()
	}
	if fail != nil {
		return fail
	}
	progress(protocol.UpdateInstalling)
	if beforeSwap != nil {
		if err := beforeSwap(); err != nil {
			return err
		}
	}
	f.mu.Lock()
	f.swapped = true
	f.mu.Unlock()
	return nil
}

func (f *fakeUpdater) installed() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string{}, f.installs...)
}

func (f *fakeUpdater) hasSwapped() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.swapped
}

func withUpdater(updater *fakeUpdater, auto bool) func(*runner.Deps) {
	return func(deps *runner.Deps) {
		deps.Updater = updater
		deps.AutoUpdate = auto
	}
}

func (c *fakeConnection) frames() []protocol.Frame {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]protocol.Frame{}, c.sent...)
}

func updateStatuses(c *fakeConnection) []protocol.UpdateStatus {
	var statuses []protocol.UpdateStatus
	for _, frame := range c.frames() {
		if status, ok := frame.(protocol.UpdateStatus); ok {
			statuses = append(statuses, status)
		}
	}
	return statuses
}

func states(statuses []protocol.UpdateStatus) []string {
	var names []string
	for _, status := range statuses {
		names = append(names, status.State)
	}
	return names
}

func eventually(t *testing.T, what string, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !done() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func equal(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func (h *harness) sawStep(step string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, status := range h.statuses {
		if status.Phase == runner.PhaseUpdating && status.Step == step {
			return true
		}
	}
	return false
}

func TestReadyWithANewerKannaUpdatesAndEndsTheRunForARestart(t *testing.T) {
	updater := &fakeUpdater{}
	h := newHarnessWith(t, withUpdater(updater, true), greeting{kind: "ready", protocolVersion: &four, serverVersion: version("1.71.0")})
	if reason := awaitExit(t, h.run()); reason != runner.ExitUpdate {
		t.Fatalf("exit %s", reason)
	}
	connection := h.server.connection(0)
	want := []string{protocol.UpdateChecking, protocol.UpdateDownloading, protocol.UpdateInstalling, protocol.UpdateRestarting}
	statuses := updateStatuses(connection)
	if !equal(states(statuses), want) {
		t.Fatalf("sent %v, want %v", states(statuses), want)
	}
	for _, status := range statuses {
		if status.Version != "1.71.0" {
			t.Fatalf("status %+v names the wrong version", status)
		}
	}
	if !connection.wasClosedByBeacon() || !updater.hasSwapped() {
		t.Fatal("the beacon must swap, then close the connection itself")
	}
	if got := h.runner.Snapshot().Status; got != (runner.Status{Phase: runner.PhaseUpdating, Version: "1.71.0", Step: protocol.UpdateRestarting}) {
		t.Fatalf("final status %+v", got)
	}
	if !h.sawStep(protocol.UpdateDownloading) || !h.sawStep(protocol.UpdateInstalling) {
		t.Fatal("the updating steps were not published")
	}
}

func TestAProtocol3ServerIsNeverSentUpdateStatus(t *testing.T) {
	updater := &fakeUpdater{}
	h := newHarnessWith(t, withUpdater(updater, true), greeting{kind: "ready", protocolVersion: &three, serverVersion: version("1.71.0")})
	if reason := awaitExit(t, h.run()); reason != runner.ExitUpdate {
		t.Fatalf("exit %s", reason)
	}
	if statuses := updateStatuses(h.server.connection(0)); len(statuses) != 0 {
		t.Fatalf("a protocol 3 server was sent %+v", statuses)
	}
}

func TestAKannaThatIsNotNewerIsLeftAlone(t *testing.T) {
	for _, server := range []string{"0.2.0", "0.1.9"} {
		updater := &fakeUpdater{}
		h := newHarnessWith(t, withUpdater(updater, true), greeting{kind: "ready", protocolVersion: &four, serverVersion: version(server)})
		h.run()
		h.waitFor(t, "online", phase(runner.PhaseOnline))
		time.Sleep(20 * time.Millisecond)
		if len(updater.installed()) != 0 || len(updateStatuses(h.server.connection(0))) != 0 {
			t.Fatalf("server %s: installs %v, statuses %+v", server, updater.installed(), updateStatuses(h.server.connection(0)))
		}
		h.runner.Stop()
	}
}

func TestUpdateNowOnAnUpToDateBeaconReportsCurrent(t *testing.T) {
	updater := &fakeUpdater{}
	h := newHarnessWith(t, withUpdater(updater, true), greeting{kind: "ready", protocolVersion: &four, serverVersion: version("0.2.0")})
	h.run()
	h.waitFor(t, "online", phase(runner.PhaseOnline))
	connection := h.server.connection(0)
	connection.push(protocol.Update{})
	eventually(t, "current", func() bool { return len(updateStatuses(connection)) == 1 })
	if got := updateStatuses(connection)[0]; got.State != protocol.UpdateCurrent || got.Version != "0.2.0" {
		t.Fatalf("sent %+v", got)
	}
	if len(updater.installed()) != 0 || h.runner.Snapshot().Status.Phase != runner.PhaseOnline {
		t.Fatal("an up-to-date beacon must stay online and install nothing")
	}
	h.runner.Stop()
}

func TestWithAutoUpdateOffOnlyUpdateNowInstalls(t *testing.T) {
	updater := &fakeUpdater{}
	h := newHarnessWith(t, withUpdater(updater, false), greeting{kind: "ready", protocolVersion: &four, serverVersion: version("1.71.0")})
	exit := h.run()
	h.waitFor(t, "online", phase(runner.PhaseOnline))
	time.Sleep(20 * time.Millisecond)
	if len(updater.installed()) != 0 {
		t.Fatal("an automatic update ran with auto-update off")
	}
	h.server.connection(0).push(protocol.Update{})
	if reason := awaitExit(t, exit); reason != runner.ExitUpdate {
		t.Fatalf("exit %s", reason)
	}
}

func TestAFailedInstallReportsWhyStaysOnlineAndBacksOff(t *testing.T) {
	updater := &fakeUpdater{fail: errors.New("release v1.71.0 has no kanna-beacon-win7-x64.exe yet")}
	ready := greeting{kind: "ready", protocolVersion: &four, serverVersion: version("1.71.0")}
	h := newHarnessWith(t, withUpdater(updater, true), ready)
	h.run()
	eventually(t, "a connection", func() bool { return h.server.count() == 1 })
	connection := h.server.connection(0)
	eventually(t, "failed", func() bool {
		statuses := updateStatuses(connection)
		return len(statuses) > 0 && statuses[len(statuses)-1].State == protocol.UpdateFailed
	})
	statuses := updateStatuses(connection)
	failed := statuses[len(statuses)-1]
	if failed.Message == nil || *failed.Message != "release v1.71.0 has no kanna-beacon-win7-x64.exe yet" {
		t.Fatalf("failed %+v", failed)
	}
	if !equal(states(statuses), []string{protocol.UpdateChecking, protocol.UpdateDownloading, protocol.UpdateFailed}) {
		t.Fatalf("sent %v", states(statuses))
	}
	h.waitFor(t, "online again", phase(runner.PhaseOnline))
	if connection.wasClosedByBeacon() {
		t.Fatal("a failed update must not drop the connection")
	}
	if !h.sawStep(protocol.UpdateFailed) {
		t.Fatal("the failure was not published")
	}

	connection.drop()
	h.waitFor(t, "offline", phase(runner.PhaseOffline))
	h.clock.fireAll()
	h.waitFor(t, "online again", func(s runner.Snapshot) bool { return s.Status.Phase == runner.PhaseOnline && h.server.count() == 2 })
	time.Sleep(20 * time.Millisecond)
	if got := updater.installed(); len(got) != 1 {
		t.Fatalf("an automatic retry inside the backoff ran: %v", got)
	}

	h.server.connection(1).push(protocol.Update{})
	eventually(t, "a manual retry", func() bool { return len(updater.installed()) == 2 })
	h.runner.Stop()
}

func TestTheRestartWaitsForAnInFlightRequest(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(helperEnv, "1")
	flag := filepath.Join(t.TempDir(), "flag")
	scope := granted
	scope.Exec = true
	scope.PerCallTimeoutMs = 20000
	updater := &fakeUpdater{}
	h := newHarnessWith(t, withUpdater(updater, false), greeting{kind: "ready", protocolVersion: &four, serverVersion: version("1.71.0"), scope: &scope})
	exit := h.run()
	h.waitFor(t, "online", phase(runner.PhaseOnline))
	connection := h.server.connection(0)
	connection.push(protocol.RequestFrame{ID: "a", Request: protocol.Request{Op: protocol.OpExec, Cmd: exe, Args: []string{"wait-for", flag}}})
	eventually(t, "the request to start", func() bool {
		for _, frame := range connection.frames() {
			if frame == (protocol.Stdout{ID: "a", Chunk: "started"}) {
				return true
			}
		}
		return false
	})
	connection.push(protocol.Update{})
	eventually(t, "installing", func() bool { return h.sawStep(protocol.UpdateInstalling) })
	time.Sleep(100 * time.Millisecond)
	if updater.hasSwapped() || connection.wasClosedByBeacon() {
		t.Fatal("the swap ran while a request was in flight")
	}
	if err := os.WriteFile(flag, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if reason := awaitExit(t, exit); reason != runner.ExitUpdate {
		t.Fatalf("exit %s", reason)
	}
	exitAt, restartingAt := -1, -1
	for index, frame := range connection.frames() {
		if frame == (protocol.Exit{ID: "a", Code: 0}) {
			exitAt = index
		}
		if status, ok := frame.(protocol.UpdateStatus); ok && status.State == protocol.UpdateRestarting {
			restartingAt = index
		}
	}
	if exitAt < 0 || restartingAt < exitAt {
		t.Fatalf("restarting (%d) was reported before the request finished (%d)", restartingAt, exitAt)
	}
}

func TestADroppedConnectionCancelsTheInstallWithoutCountingAFailure(t *testing.T) {
	updater := &fakeUpdater{hang: true}
	h := newHarnessWith(t, withUpdater(updater, true), greeting{kind: "ready", protocolVersion: &four, serverVersion: version("1.71.0")})
	h.run()
	eventually(t, "downloading", func() bool { return h.sawStep(protocol.UpdateDownloading) })
	h.server.connection(0).drop()
	h.waitFor(t, "offline", phase(runner.PhaseOffline))
	if failed := h.sawStep(protocol.UpdateFailed); failed {
		t.Fatal("a cancelled install was reported as failed")
	}
	h.clock.fireAll()
	eventually(t, "the install to start again", func() bool { return len(updater.installed()) == 2 })
	h.runner.Stop()
}

func TestAnIncompatibleKannaThatIsNewerIsInstalled(t *testing.T) {
	updater := &fakeUpdater{}
	h := newHarnessWith(t, withUpdater(updater, true), greeting{kind: "incompatible", serverVersion: version("1.80.0")})
	if reason := awaitExit(t, h.run()); reason != runner.ExitUpdate {
		t.Fatalf("exit %s", reason)
	}
	if got := updater.installed(); len(got) != 1 || got[0] != "1.80.0" {
		t.Fatalf("installed %v", got)
	}
	if got := h.runner.Snapshot().Status; got.Phase != runner.PhaseUpdating || got.Step != protocol.UpdateRestarting {
		t.Fatalf("status %+v", got)
	}
}

func TestAnIncompatibleKannaStaysIncompatibleWhenNoUpdateHelps(t *testing.T) {
	cases := []struct {
		name     string
		server   *string
		auto     bool
		fail     error
		installs int
	}{
		{"no server version", nil, true, nil, 0},
		{"an older server", version("0.1.0"), true, nil, 0},
		{"auto-update off", version("1.80.0"), false, nil, 0},
		{"the install fails", version("1.80.0"), true, errors.New("no asset"), 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			updater := &fakeUpdater{fail: tc.fail}
			h := newHarnessWith(t, withUpdater(updater, tc.auto), greeting{kind: "incompatible", serverVersion: tc.server})
			if reason := awaitExit(t, h.run()); reason != runner.ExitIncompatible {
				t.Fatalf("exit %s", reason)
			}
			if got := updater.installed(); len(got) != tc.installs {
				t.Fatalf("installed %v", got)
			}
			if got := h.runner.Snapshot().Status; got.Phase != runner.PhaseIncompatible {
				t.Fatalf("status %+v", got)
			}
		})
	}
}
