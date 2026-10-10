package cli_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/cli"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
)

const helperDirEnv = "KANNA_CLI_SUPERVISE_HELPER"

// TestMain lets the test binary double as a supervised beacon: the first run
// exits with the restart code, the next with 3. A run that was not started
// as supervised exits with 4.
func TestMain(m *testing.M) {
	dir := os.Getenv(helperDirEnv)
	if dir == "" {
		os.Exit(m.Run())
	}
	if os.Getenv(cli.SupervisedEnv) != "1" {
		os.Exit(4)
	}
	if len(os.Args) != 2 || os.Args[1] != "run" {
		os.Exit(5)
	}
	marker := filepath.Join(dir, "updated")
	if _, err := os.Stat(marker); err != nil {
		_ = os.WriteFile(marker, nil, 0o644)
		os.Exit(cli.RestartExitCode)
	}
	os.Exit(3)
}

func TestTheVersionCommandPrintsTheBeaconVersionToStandardOutput(t *testing.T) {
	var logs, printed logger
	deps := newDeps(t, &logs)
	deps.BeaconVersion = "1.71.0"
	deps.Print = printed.log
	if code := cli.Run([]string{"version"}, deps); code != 0 {
		t.Fatalf("exit code %d", code)
	}
	if printed.text() != "1.71.0" || logs.text() != "" {
		t.Fatalf("printed %q, logged %q", printed.text(), logs.text())
	}
}

type installRecord struct {
	mu       sync.Mutex
	versions []string
}

func (r *installRecord) Install(_ context.Context, version string, progress func(step string), beforeSwap func() error) error {
	r.mu.Lock()
	r.versions = append(r.versions, version)
	r.mu.Unlock()
	progress(protocol.UpdateDownloading)
	progress(protocol.UpdateInstalling)
	return beforeSwap()
}

func TestRunExitsWithTheRestartCodeOnceANewerBuildIsInstalled(t *testing.T) {
	statuses := make(chan []string, 1)
	url, _ := beaconServer(t, func(index int, conn *websocket.Conn) {
		readFrame(t, conn)
		writeFrame(t, conn, protocol.Challenge{Nonce: "n"})
		readFrame(t, conn)
		four := 4.0
		serverVersion := "1.71.0"
		writeFrame(t, conn, protocol.Ready{Scope: protocol.Scope{MaxConcurrent: 1}, ProtocolVersion: &four, ServerVersion: &serverVersion})
		var states []string
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				break
			}
			if frame, ok := protocol.ParseFrame(data); ok {
				if status, isStatus := frame.(protocol.UpdateStatus); isStatus {
					states = append(states, status.State)
				}
			}
		}
		statuses <- states
	})
	var logs logger
	deps := pairedDeps(t, &logs, url)
	updater := &installRecord{}
	deps.Updater = updater
	deps.AutoUpdate = true
	if code := cli.Run([]string{"run"}, deps); code != cli.RestartExitCode {
		t.Fatalf("exit code %d: %s", code, logs.text())
	}
	select {
	case got := <-statuses:
		if strings.Join(got, ",") != "checking,downloading,installing,restarting" {
			t.Fatalf("server heard %v", got)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the server never saw the connection end")
	}
	if len(updater.versions) != 1 || updater.versions[0] != "1.71.0" {
		t.Fatalf("installed %v", updater.versions)
	}
	if !strings.HasSuffix(logs.text(), "updated to 1.71.0; restarting") {
		t.Fatalf("logged %q", logs.text())
	}
}

type scriptedChild struct {
	code     int
	exited   chan struct{}
	mu       sync.Mutex
	received []os.Signal
}

func (c *scriptedChild) Wait() int {
	<-c.exited
	return c.code
}

func (c *scriptedChild) Signal(sig os.Signal) {
	c.mu.Lock()
	c.received = append(c.received, sig)
	c.mu.Unlock()
	close(c.exited)
}

func exitedWith(code int) *scriptedChild {
	child := &scriptedChild{code: code, exited: make(chan struct{})}
	close(child.exited)
	return child
}

func TestSuperviseRestartsWhileTheChildAsksAndReturnsItsLastCode(t *testing.T) {
	cases := []struct {
		name   string
		codes  []int
		want   int
		spawns int
	}{
		{"a clean exit ends at once", []int{0}, 0, 1},
		{"a failure ends at once", []int{2}, 2, 1},
		{"each restart starts a new child", []int{75, 75, 1}, 1, 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			spawns := 0
			spawn := func() (cli.Child, error) {
				code := tc.codes[spawns]
				spawns++
				return exitedWith(code), nil
			}
			var logs logger
			if got := cli.Supervise(spawn, nil, logs.log); got != tc.want || spawns != tc.spawns {
				t.Fatalf("Supervise = %d after %d spawns, want %d after %d", got, spawns, tc.want, tc.spawns)
			}
		})
	}
}

func TestSuperviseReportsAChildThatCannotStart(t *testing.T) {
	var logs logger
	code := cli.Supervise(func() (cli.Child, error) { return nil, errors.New("access denied") }, nil, logs.log)
	if code != cli.FailureExitCode || logs.text() != "could not start the updated beacon: access denied" {
		t.Fatalf("exit %d, logged %q", code, logs.text())
	}
}

func TestSuperviseForwardsSignalsToTheChild(t *testing.T) {
	child := &scriptedChild{code: 130, exited: make(chan struct{})}
	signals := make(chan os.Signal, 1)
	signals <- syscall.SIGTERM
	var logs logger
	if code := cli.Supervise(func() (cli.Child, error) { return child, nil }, signals, logs.log); code != 130 {
		t.Fatalf("exit %d", code)
	}
	if len(child.received) != 1 || child.received[0] != syscall.SIGTERM {
		t.Fatalf("child received %v", child.received)
	}
}

func TestSpawnSelfRestartsTheRealExecutableAsSupervised(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(helperDirEnv, t.TempDir())
	var logs logger
	if code := cli.Supervise(cli.SpawnSelf(exe, []string{"run"}), nil, logs.log); code != 3 {
		t.Fatalf("exit %d, logged %q", code, logs.text())
	}
}
