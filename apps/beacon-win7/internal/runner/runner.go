// Package runner mirrors src/beacon/runner.ts: it keeps one session
// connected, reconnecting with exponential backoff, and reports its status.
package runner

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/fsops"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/selfupdate"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/session"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/state"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transfer"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transport"
)

var errNoUpdater = errors.New("this beacon cannot update itself")

// MaxBackoff caps the reconnect delay.
const MaxBackoff = 30 * time.Second

// Backoff is min(30 s, 1 s * 2^(attempt-1)).
func Backoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 6 {
		return MaxBackoff
	}
	delay := time.Second << (attempt - 1)
	if delay > MaxBackoff {
		return MaxBackoff
	}
	return delay
}

var trailingSlashes = regexp.MustCompile(`/+$`)

// SocketURL maps a Kanna URL onto its /beacon WebSocket endpoint.
func SocketURL(kannaURL string) string {
	trimmed := trailingSlashes.ReplaceAllString(kannaURL, "")
	if strings.HasPrefix(trimmed, "http") {
		trimmed = "ws" + trimmed[len("http"):]
	}
	return trimmed + "/beacon"
}

// Phases a runner reports.
const (
	PhaseConnecting   = "connecting"
	PhaseOnline       = "online"
	PhaseOffline      = "offline"
	PhaseRevoked      = "revoked"
	PhaseIncompatible = "incompatible"
	PhaseUpdating     = "updating"
	PhaseStopped      = "stopped"
)

// Offline reasons.
const (
	ReasonUnreachable = "unreachable"
	ReasonDisabled    = "disabled"
)

// Exit reasons Run returns.
const (
	ExitIncompatible = "incompatible"
	ExitRevoked      = "revoked"
	ExitUnpaired     = "unpaired"
	ExitStopped      = "stopped"
	// ExitUpdate means a new build replaced this executable; the caller
	// restarts it.
	ExitUpdate = "update"
)

// Status is the runner's current phase; only the fields of that phase are set.
// An updating status carries the target Version and the Step, one of the
// protocol.Update* states; a failed step also carries a Message.
type Status struct {
	Phase        string
	Attempt      int
	Since        time.Time
	RetryAt      time.Time
	Reason       string
	MinSupported float64
	DownloadURL  *string
	Version      string
	Step         string
	Message      string
}

// Updater installs a release over the running executable. progress hears
// each step; beforeSwap runs once the new build is verified and before it
// replaces the running one, and an error from it abandons the install.
type Updater interface {
	Install(ctx context.Context, version string, progress func(step string), beforeSwap func() error) error
}

// Snapshot is what a status listener sees.
type Snapshot struct {
	Status    Status
	Scope     *protocol.Scope
	ScopeSync bool
}

// Deps wires the runner. After and Now default to the real clock.
type Deps struct {
	State         state.State
	OS            string
	BeaconVersion string
	Signer        session.Signer
	OpenTransport func(url string) transport.Transport
	After         func(time.Duration) <-chan time.Time
	Now           func() time.Time
	// Updater, when set, lets the beacon update itself to its Kanna's
	// version. AutoUpdate makes it do so on connecting to a newer Kanna;
	// without it only Kanna's Update now button starts an update.
	Updater    Updater
	AutoUpdate bool
}

type outcome struct {
	kind            string
	wasOnline       bool
	refusedDisabled bool
	minSupported    float64
	downloadURL     *string
	serverVersion   string
}

type liveConnection struct {
	transport transport.Transport
	session   *session.Session
	closed    chan struct{}
	ctx       context.Context
	since     time.Time
	// installed is closed when an install started on this connection ends;
	// nil when none started. Guarded by Runner.mu.
	installed chan struct{}
}

// Runner keeps a beacon connected.
type Runner struct {
	deps Deps
	url  string
	fs   *fsops.FS

	transfer *transfer.Transferer

	publishMu sync.Mutex
	mu        sync.Mutex
	status    Status
	scope     *protocol.Scope
	protocol  float64
	stopped   bool
	unpairing bool
	live      *liveConnection

	stopCtx     context.Context
	stopRun     context.CancelFunc
	updating    bool
	restartInto string
	lastFailure *selfupdate.Failure
	wake        chan struct{}
	listeners   map[int]func(Snapshot)
	nextID      int
}

// New returns a runner that has not started connecting.
func New(deps Deps) *Runner {
	if deps.After == nil {
		deps.After = time.After
	}
	if deps.Now == nil {
		deps.Now = time.Now
	}
	stopCtx, stopRun := context.WithCancel(context.Background())
	r := &Runner{
		deps:      deps,
		stopCtx:   stopCtx,
		stopRun:   stopRun,
		url:       SocketURL(deps.State.KannaURL),
		status:    Status{Phase: PhaseConnecting, Attempt: 1},
		protocol:  protocol.MinBeaconProtocol,
		wake:      make(chan struct{}, 1),
		listeners: make(map[int]func(Snapshot)),
	}
	r.fs = fsops.New(r.readRoots)
	r.transfer = transfer.New(transfer.Config{
		BaseURL:     deps.State.KannaURL,
		Version:     deps.BeaconVersion,
		ContainRead: r.fs.Contain,
		WriteRoots:  r.writeRoots,
	})
	return r
}

func (r *Runner) writeRoots() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.scope == nil {
		return nil
	}
	return r.scope.WriteRoots
}

func (r *Runner) readRoots() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.scope == nil {
		return nil
	}
	return r.scope.ReadRoots
}

func (r *Runner) snapshotLocked() Snapshot {
	online := r.status.Phase == PhaseOnline || (r.status.Phase == PhaseUpdating && r.live != nil)
	return Snapshot{Status: r.status, Scope: r.scope, ScopeSync: online && r.protocol >= protocol.ScopeSyncProtocol}
}

// Snapshot returns the current status and scope.
func (r *Runner) Snapshot() Snapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.snapshotLocked()
}

// Subscribe registers a listener for every status or scope change and
// returns a function that removes it.
func (r *Runner) Subscribe(listener func(Snapshot)) func() {
	r.mu.Lock()
	defer r.mu.Unlock()
	id := r.nextID
	r.nextID++
	r.listeners[id] = listener
	return func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		delete(r.listeners, id)
	}
}

func (r *Runner) update(change func()) {
	r.updateIf(func() bool { return true }, change)
}

// updateIf applies change and publishes the result when applies, read under
// the same lock, holds.
func (r *Runner) updateIf(applies func() bool, change func()) {
	r.publishMu.Lock()
	defer r.publishMu.Unlock()
	r.mu.Lock()
	if !applies() {
		r.mu.Unlock()
		return
	}
	change()
	current := r.snapshotLocked()
	listeners := make([]func(Snapshot), 0, len(r.listeners))
	for id := 0; id < r.nextID; id++ {
		if listener, ok := r.listeners[id]; ok {
			listeners = append(listeners, listener)
		}
	}
	r.mu.Unlock()
	for _, listener := range listeners {
		listener(current)
	}
}

func (r *Runner) setStatus(status Status) {
	r.update(func() { r.status = status })
}

func (r *Runner) nudge() {
	select {
	case r.wake <- struct{}{}:
	default:
	}
}

func (r *Runner) attempt() outcome {
	ctx, cancel := context.WithCancel(r.stopCtx)
	closed := make(chan struct{})
	var once sync.Once
	conn := r.deps.OpenTransport(r.url)
	conn.OnClose(func() {
		once.Do(func() {
			cancel()
			close(closed)
		})
	})
	live := &liveConnection{transport: conn, closed: closed, ctx: ctx}
	var resultMu sync.Mutex
	result := outcome{kind: "closed"}
	s := session.New(session.Deps{
		BeaconID:      r.deps.State.BeaconID,
		BeaconVersion: r.deps.BeaconVersion,
		OS:            r.deps.OS,
		Transport:     conn,
		Signer:        r.deps.Signer,
		FS:            r.fs,
		Transfer:      r.transfer,
		OnReady: func(granted protocol.Scope, serverProtocol float64, serverVersion string) {
			resultMu.Lock()
			result.wasOnline = true
			resultMu.Unlock()
			r.update(func() {
				live.since = r.deps.Now()
				r.scope = &granted
				r.protocol = serverProtocol
				r.status = Status{Phase: PhaseOnline, Since: live.since}
			})
			r.considerUpdate(live, serverVersion, selfupdate.Auto)
		},
		OnUpdateRequested: func() {
			r.considerUpdate(live, live.session.ServerVersion(), selfupdate.Manual)
		},
		OnScope: func(granted protocol.Scope) {
			r.update(func() { r.scope = &granted })
		},
		OnRefused: func(reason string) {
			resultMu.Lock()
			defer resultMu.Unlock()
			if reason == protocol.RefusalUnknownBeacon {
				result.kind = PhaseRevoked
			} else {
				result.refusedDisabled = true
			}
		},
		OnIncompatible: func(frame protocol.Incompatible) {
			resultMu.Lock()
			defer resultMu.Unlock()
			result.kind = PhaseIncompatible
			result.minSupported = frame.MinSupported
			result.downloadURL = frame.DownloadURL
			if frame.ServerVersion != nil {
				result.serverVersion = *frame.ServerVersion
			}
		},
	})
	live.session = s
	r.mu.Lock()
	r.live = live
	r.mu.Unlock()
	s.Start()
	<-closed
	r.mu.Lock()
	r.live = nil
	installed := live.installed
	r.mu.Unlock()
	if installed != nil {
		<-installed
	}
	resultMu.Lock()
	defer resultMu.Unlock()
	return result
}

func (r *Runner) flags() (stopped, unpairing bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.stopped, r.unpairing
}

// Run connects until the runner is stopped, unpaired, revoked, refused as
// incompatible, or updated, and returns which of those ended it.
func (r *Runner) Run() string {
	failures := 0
	for {
		if stopped, _ := r.flags(); stopped {
			r.setStatus(Status{Phase: PhaseStopped})
			return ExitStopped
		}
		r.setStatus(Status{Phase: PhaseConnecting, Attempt: failures + 1})
		result := r.attempt()
		if version := r.takeRestart(); version != "" {
			r.setStatus(Status{Phase: PhaseUpdating, Version: version, Step: protocol.UpdateRestarting})
			return ExitUpdate
		}
		switch result.kind {
		case PhaseIncompatible:
			if r.updateWhileIncompatible(result.serverVersion) {
				return ExitUpdate
			}
			if stopped, _ := r.flags(); stopped {
				r.setStatus(Status{Phase: PhaseStopped})
				return ExitStopped
			}
			r.setStatus(Status{Phase: PhaseIncompatible, MinSupported: result.minSupported, DownloadURL: result.downloadURL})
			return ExitIncompatible
		case PhaseRevoked:
			r.setStatus(Status{Phase: PhaseRevoked})
			return ExitRevoked
		}
		stopped, unpairing := r.flags()
		if unpairing {
			r.setStatus(Status{Phase: PhaseStopped})
			return ExitUnpaired
		}
		if stopped {
			continue
		}
		if result.wasOnline {
			failures = 1
		} else {
			failures++
		}
		delay := Backoff(failures)
		reason := ReasonUnreachable
		if result.refusedDisabled {
			reason = ReasonDisabled
		}
		r.setStatus(Status{Phase: PhaseOffline, Attempt: failures, RetryAt: r.deps.Now().Add(delay), Reason: reason})
		select {
		case <-r.wake:
		case <-r.deps.After(delay):
		}
	}
}

func (r *Runner) takeRestart() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	version := r.restartInto
	r.restartInto = ""
	return version
}

// considerUpdate applies the update rule to serverVersion and, when it says
// install, starts the install beside the live connection.
func (r *Runner) considerUpdate(live *liveConnection, serverVersion string, trigger selfupdate.Trigger) {
	r.mu.Lock()
	if r.updating || live.ctx.Err() != nil {
		r.mu.Unlock()
		return
	}
	decision := selfupdate.Decide(r.deps.BeaconVersion, serverVersion, trigger, r.deps.AutoUpdate, r.lastFailure, r.deps.Now())
	var installed chan struct{}
	if decision.Kind == selfupdate.Install {
		r.updating = true
		installed = make(chan struct{})
		live.installed = installed
	}
	r.mu.Unlock()
	switch decision.Kind {
	case selfupdate.Current:
		live.session.SendUpdateStatus(protocol.UpdateCurrent, decision.Version, nil)
	case selfupdate.Install:
		go func() {
			defer close(installed)
			r.installOnline(live, decision.Version)
		}()
	}
}

// updateLive applies change and publishes it only while live is still the
// runner's connection, so a late step never overwrites an offline status.
func (r *Runner) updateLive(live *liveConnection, change func()) {
	r.updateIf(func() bool { return r.live == live && live.ctx.Err() == nil }, change)
}

func (r *Runner) recordFailure(version string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lastFailure = &selfupdate.Failure{Version: version, At: r.deps.Now()}
}

// installOnline downloads at once, but swaps only when no request is running
// or queued, so an exec in flight finishes first. On success it reports
// restarting and closes the connection, and Run returns ExitUpdate. On
// failure it reports why and the beacon stays online. A connection that
// drops mid-install cancels it without counting as a failure; the
// connection's attempt waits for it to return, so the next ready decides
// afresh and starts it again.
func (r *Runner) installOnline(live *liveConnection, version string) {
	defer func() {
		r.mu.Lock()
		r.updating = false
		r.mu.Unlock()
	}()
	report := func(step string) {
		r.updateLive(live, func() { r.status = Status{Phase: PhaseUpdating, Version: version, Step: step} })
		live.session.SendUpdateStatus(step, version, nil)
	}
	report(protocol.UpdateChecking)
	err := errNoUpdater
	if r.deps.Updater != nil {
		err = r.deps.Updater.Install(live.ctx, version, report, func() error { return live.session.WaitIdle(live.ctx) })
	}
	if err == nil {
		report(protocol.UpdateRestarting)
		r.mu.Lock()
		r.restartInto = version
		r.mu.Unlock()
		live.transport.Close()
		return
	}
	if live.ctx.Err() != nil {
		return
	}
	r.recordFailure(version)
	message := err.Error()
	live.session.SendUpdateStatus(protocol.UpdateFailed, version, &message)
	r.updateLive(live, func() {
		r.status = Status{Phase: PhaseUpdating, Version: version, Step: protocol.UpdateFailed, Message: message}
	})
	r.updateLive(live, func() { r.status = Status{Phase: PhaseOnline, Since: live.since} })
}

// updateWhileIncompatible handles a server that refused this beacon's
// protocol but announced a newer version: installing that version is the way
// back. It follows the automatic rule, since nobody pressed a button.
func (r *Runner) updateWhileIncompatible(serverVersion string) bool {
	r.mu.Lock()
	decision := selfupdate.Decide(r.deps.BeaconVersion, serverVersion, selfupdate.Auto, r.deps.AutoUpdate, r.lastFailure, r.deps.Now())
	r.mu.Unlock()
	if decision.Kind != selfupdate.Install || r.deps.Updater == nil {
		return false
	}
	version := decision.Version
	report := func(step string) {
		r.setStatus(Status{Phase: PhaseUpdating, Version: version, Step: step})
	}
	report(protocol.UpdateChecking)
	if err := r.deps.Updater.Install(r.stopCtx, version, report, nil); err != nil {
		if r.stopCtx.Err() == nil {
			r.recordFailure(version)
		}
		return false
	}
	report(protocol.UpdateRestarting)
	return true
}

// Stop ends the run, closing the live connection and abandoning any update
// still downloading.
func (r *Runner) Stop() {
	r.mu.Lock()
	r.stopped = true
	live := r.live
	r.mu.Unlock()
	r.stopRun()
	if live != nil {
		live.transport.Close()
	}
	r.nudge()
}

// RequestScopeChange forwards a scope change to the live session.
func (r *Runner) RequestScopeChange(change protocol.ScopeChange) bool {
	r.mu.Lock()
	live := r.live
	r.mu.Unlock()
	return live != nil && live.session.RequestScopeChange(change)
}

// Unpair asks Kanna to forget this beacon and waits up to timeout for the
// server to close the connection. It returns whether Kanna acknowledged;
// false when the beacon is offline or the server predates scope sync.
func (r *Runner) Unpair(timeout time.Duration) bool {
	r.mu.Lock()
	live := r.live
	r.mu.Unlock()
	if live == nil || !live.session.RequestUnpair() {
		return false
	}
	r.mu.Lock()
	r.unpairing = true
	r.mu.Unlock()
	select {
	case <-live.closed:
		return true
	case <-r.deps.After(timeout):
		live.transport.Close()
		r.nudge()
		return false
	}
}
