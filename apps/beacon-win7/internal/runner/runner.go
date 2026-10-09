// Package runner mirrors src/beacon/runner.ts: it keeps one session
// connected, reconnecting with exponential backoff, and reports its status.
package runner

import (
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/fsops"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/session"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/state"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transport"
)

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
)

// Status is the runner's current phase; only the fields of that phase are set.
type Status struct {
	Phase        string
	Attempt      int
	Since        time.Time
	RetryAt      time.Time
	Reason       string
	MinSupported float64
	DownloadURL  *string
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
}

type outcome struct {
	kind            string
	wasOnline       bool
	refusedDisabled bool
	minSupported    float64
	downloadURL     *string
}

type liveConnection struct {
	transport transport.Transport
	session   *session.Session
	closed    chan struct{}
}

// Runner keeps a beacon connected.
type Runner struct {
	deps Deps
	url  string
	fs   *fsops.FS

	publishMu sync.Mutex
	mu        sync.Mutex
	status    Status
	scope     *protocol.Scope
	protocol  float64
	stopped   bool
	unpairing bool
	live      *liveConnection
	wake      chan struct{}
	listeners map[int]func(Snapshot)
	nextID    int
}

// New returns a runner that has not started connecting.
func New(deps Deps) *Runner {
	if deps.After == nil {
		deps.After = time.After
	}
	if deps.Now == nil {
		deps.Now = time.Now
	}
	r := &Runner{
		deps:      deps,
		url:       SocketURL(deps.State.KannaURL),
		status:    Status{Phase: PhaseConnecting, Attempt: 1},
		protocol:  protocol.MinBeaconProtocol,
		wake:      make(chan struct{}, 1),
		listeners: make(map[int]func(Snapshot)),
	}
	r.fs = fsops.New(r.readRoots)
	return r
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
	online := r.status.Phase == PhaseOnline
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
	r.publishMu.Lock()
	defer r.publishMu.Unlock()
	r.mu.Lock()
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
	conn := r.deps.OpenTransport(r.url)
	closed := make(chan struct{})
	var once sync.Once
	conn.OnClose(func() { once.Do(func() { close(closed) }) })
	var resultMu sync.Mutex
	result := outcome{kind: "closed"}
	s := session.New(session.Deps{
		BeaconID:      r.deps.State.BeaconID,
		BeaconVersion: r.deps.BeaconVersion,
		OS:            r.deps.OS,
		Transport:     conn,
		Signer:        r.deps.Signer,
		FS:            r.fs,
		OnReady: func(granted protocol.Scope, serverProtocol float64) {
			resultMu.Lock()
			result.wasOnline = true
			resultMu.Unlock()
			r.update(func() {
				r.scope = &granted
				r.protocol = serverProtocol
				r.status = Status{Phase: PhaseOnline, Since: r.deps.Now()}
			})
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
		},
	})
	r.mu.Lock()
	r.live = &liveConnection{transport: conn, session: s, closed: closed}
	r.mu.Unlock()
	s.Start()
	<-closed
	r.mu.Lock()
	r.live = nil
	r.mu.Unlock()
	resultMu.Lock()
	defer resultMu.Unlock()
	return result
}

func (r *Runner) flags() (stopped, unpairing bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.stopped, r.unpairing
}

// Run connects until the runner is stopped, unpaired, revoked, or refused as
// incompatible, and returns which of those ended it.
func (r *Runner) Run() string {
	failures := 0
	for {
		if stopped, _ := r.flags(); stopped {
			r.setStatus(Status{Phase: PhaseStopped})
			return ExitStopped
		}
		r.setStatus(Status{Phase: PhaseConnecting, Attempt: failures + 1})
		result := r.attempt()
		switch result.kind {
		case PhaseIncompatible:
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

// Stop ends the run, closing the live connection.
func (r *Runner) Stop() {
	r.mu.Lock()
	r.stopped = true
	live := r.live
	r.mu.Unlock()
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
