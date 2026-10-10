// Package session mirrors src/beacon/session.ts: the handshake, the request
// queue, and serving each request with the scope captured when it arrived.
package session

import (
	"context"
	"errors"
	"math"
	"sync"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/fsops"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/shell"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transfer"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transport"
)

// Error messages the TypeScript session sends.
const (
	ExecRefused          = "exec not permitted"
	UnsupportedOperation = "unsupported operation"
)

// Signer signs a challenge nonce.
type Signer interface {
	Sign(nonce string) string
}

// Deps wires a session to its connection, identity and handlers. Every
// callback is optional.
type Deps struct {
	BeaconID       string
	BeaconVersion  string
	OS             string
	Transport      transport.Transport
	Signer         Signer
	FS             *fsops.FS
	Transfer       *transfer.Transferer
	OnReady        func(scope protocol.Scope, serverProtocol float64, serverVersion string)
	OnScope        func(scope protocol.Scope)
	OnRefused      func(reason string)
	OnIncompatible func(frame protocol.Incompatible)
	// OnUpdateRequested hears Kanna's Update now button. The frame carries
	// nothing: the version to install is the one from the handshake.
	OnUpdateRequested func()
}

type phase int

const (
	phaseIdle phase = iota
	phaseAwaitingChallenge
	phaseAwaitingReady
	phaseReady
	phaseStopped
)

// Session is one connection's worth of protocol state.
type Session struct {
	deps Deps

	mu             sync.Mutex
	phase          phase
	scope          *protocol.Scope
	serverProtocol float64
	serverVersion  string
	running        int
	queue          []func()
	idle           chan struct{}

	connection context.Context
	closed     context.CancelFunc
}

// New returns an idle session; call Start to announce the beacon.
func New(deps Deps) *Session {
	connection, closed := context.WithCancel(context.Background())
	return &Session{deps: deps, serverProtocol: protocol.MinBeaconProtocol, connection: connection, closed: closed}
}

// Start registers the session on its transport and sends the hello frame.
func (s *Session) Start() {
	s.mu.Lock()
	s.phase = phaseAwaitingChallenge
	s.mu.Unlock()
	s.deps.Transport.OnFrame(s.handleFrame)
	s.deps.Transport.OnClose(func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.phase = phaseStopped
		s.queue = nil
		s.signalIdleLocked()
		s.closed()
	})
	s.deps.Transport.Send(protocol.Hello{
		BeaconID:        s.deps.BeaconID,
		ProtocolVersion: protocol.BeaconProtocolVersion,
		BeaconVersion:   s.deps.BeaconVersion,
		OS:              s.deps.OS,
	})
}

func (s *Session) canSyncScope() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.phase == phaseReady && s.serverProtocol >= protocol.ScopeSyncProtocol
}

func (s *Session) canReportUpdates() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.phase == phaseReady && s.serverProtocol >= protocol.UpdateProtocol
}

// ServerVersion is the Kanna version the server announced in ready or
// incompatible, or "" when it announced none.
func (s *Session) ServerVersion() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.serverVersion
}

// SendUpdateStatus reports self-update progress. It returns false, sending
// nothing, unless the session is ready on a server that speaks protocol 4:
// an older server closes the connection on a frame it cannot parse.
func (s *Session) SendUpdateStatus(state, version string, message *string) bool {
	if !s.canReportUpdates() {
		return false
	}
	s.deps.Transport.Send(protocol.UpdateStatus{State: state, Version: version, Message: message})
	return true
}

// WaitIdle returns once no request is running or queued, or with ctx's error
// when ctx ends first.
func (s *Session) WaitIdle(ctx context.Context) error {
	for {
		s.mu.Lock()
		if s.running == 0 && len(s.queue) == 0 {
			s.mu.Unlock()
			return nil
		}
		if s.idle == nil {
			s.idle = make(chan struct{})
		}
		changed := s.idle
		s.mu.Unlock()
		select {
		case <-changed:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// signalIdleLocked wakes WaitIdle callers so they look again.
func (s *Session) signalIdleLocked() {
	if s.idle != nil {
		close(s.idle)
		s.idle = nil
	}
}

// RequestScopeChange asks the server to change the scope. It returns false,
// sending nothing, unless the session is ready on a server that speaks scope
// sync.
func (s *Session) RequestScopeChange(change protocol.ScopeChange) bool {
	if !s.canSyncScope() {
		return false
	}
	s.deps.Transport.Send(protocol.SetScope{Change: change})
	return true
}

// RequestUnpair asks the server to forget this beacon, under the same
// condition as RequestScopeChange.
func (s *Session) RequestUnpair() bool {
	if !s.canSyncScope() {
		return false
	}
	s.deps.Transport.Send(protocol.Unpair{})
	return true
}

func (s *Session) handleFrame(frame protocol.Frame) {
	switch typed := frame.(type) {
	case protocol.Incompatible:
		if s.transition(phaseAwaitingChallenge, phaseStopped) {
			s.mu.Lock()
			s.serverVersion = valueOf(typed.ServerVersion)
			s.mu.Unlock()
			if s.deps.OnIncompatible != nil {
				s.deps.OnIncompatible(typed)
			}
			s.deps.Transport.Close()
		}
	case protocol.Refused:
		if s.transition(phaseAwaitingChallenge, phaseStopped) {
			if s.deps.OnRefused != nil {
				s.deps.OnRefused(typed.Reason)
			}
			s.deps.Transport.Close()
		}
	case protocol.Challenge:
		if s.transition(phaseAwaitingChallenge, phaseAwaitingReady) {
			s.deps.Transport.Send(protocol.Auth{Signature: s.deps.Signer.Sign(typed.Nonce)})
		}
	case protocol.Ready:
		s.mu.Lock()
		if s.phase != phaseAwaitingReady {
			s.mu.Unlock()
			return
		}
		s.phase = phaseReady
		s.serverProtocol = protocol.MinBeaconProtocol
		if typed.ProtocolVersion != nil {
			s.serverProtocol = *typed.ProtocolVersion
		}
		s.serverVersion = valueOf(typed.ServerVersion)
		serverProtocol, serverVersion := s.serverProtocol, s.serverVersion
		s.mu.Unlock()
		s.adoptScope(typed.Scope)
		if s.deps.OnReady != nil {
			s.deps.OnReady(typed.Scope, serverProtocol, serverVersion)
		}
	case protocol.ScopeFrame:
		if s.isReady() {
			s.adoptScope(typed.Scope)
		}
	case protocol.Update:
		if s.isReady() && s.deps.OnUpdateRequested != nil {
			s.deps.OnUpdateRequested()
		}
	case protocol.Ping:
		if s.isReady() {
			s.deps.Transport.Send(protocol.Pong{})
		}
	case protocol.RequestFrame:
		s.mu.Lock()
		if s.phase != phaseReady || s.scope == nil {
			s.mu.Unlock()
			return
		}
		granted := *s.scope
		s.mu.Unlock()
		s.enqueue(typed.ID, typed.Request, granted)
	}
}

func (s *Session) transition(from, to phase) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.phase != from {
		return false
	}
	s.phase = to
	return true
}

func (s *Session) isReady() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.phase == phaseReady
}

func (s *Session) adoptScope(scope protocol.Scope) {
	s.mu.Lock()
	s.scope = &scope
	s.mu.Unlock()
	if s.deps.OnScope != nil {
		s.deps.OnScope(scope)
	}
}

func (s *Session) enqueue(id string, request protocol.Request, granted protocol.Scope) {
	s.mu.Lock()
	s.queue = append(s.queue, func() {
		go func() {
			s.serve(id, request, granted)
			s.mu.Lock()
			s.running--
			s.signalIdleLocked()
			s.mu.Unlock()
			s.drain()
		}()
	})
	s.mu.Unlock()
	s.drain()
}

// drain starts queued jobs while fewer than max(1, maxConcurrent) run; the
// limit is re-read from the current scope every time.
func (s *Session) drain() {
	s.mu.Lock()
	defer s.mu.Unlock()
	limit := 1.0
	if s.scope != nil {
		limit = s.scope.MaxConcurrent
	}
	for float64(s.running) < math.Max(1, limit) && len(s.queue) > 0 {
		next := s.queue[0]
		s.queue = s.queue[1:]
		s.running++
		next()
	}
}

type sink struct {
	id        string
	transport transport.Transport
}

func (k sink) Stdout(chunk string) { k.transport.Send(protocol.Stdout{ID: k.id, Chunk: chunk}) }
func (k sink) Stderr(chunk string) { k.transport.Send(protocol.Stderr{ID: k.id, Chunk: chunk}) }

func (s *Session) serve(id string, request protocol.Request, granted protocol.Scope) {
	send := s.deps.Transport.Send
	if request.Op == protocol.OpExec || request.Op == protocol.OpScript {
		code, err := s.runShell(id, request, granted)
		if err != nil {
			send(protocol.ErrorFrame{ID: id, Message: err.Error()})
			return
		}
		send(protocol.Exit{ID: id, Code: float64(code)})
		return
	}
	var result any
	var err error
	if request.Op == protocol.OpUpload || request.Op == protocol.OpDownload {
		result, err = s.runTransfer(request)
	} else {
		result, err = s.runFS(request)
	}
	if err != nil {
		send(protocol.ErrorFrame{ID: id, Message: err.Error()})
		return
	}
	send(protocol.Result{ID: id, Result: result})
}

func (s *Session) runShell(id string, request protocol.Request, granted protocol.Scope) (int, error) {
	if !granted.Exec {
		return 0, errors.New(ExecRefused)
	}
	limits := shell.LimitsFromScope(granted.PerCallTimeoutMs, granted.OutputByteCap)
	out := sink{id: id, transport: s.deps.Transport}
	if request.Op == protocol.OpExec {
		cwd := ""
		if request.Cwd != nil {
			cwd = *request.Cwd
		}
		return shell.Exec(request.Cmd, request.Args, cwd, out, limits), nil
	}
	return shell.Script(request.Body, out, limits), nil
}

// runTransfer carries no per-call timeout and no output cap: a transfer ends
// when it finishes, fails, or the connection drops, which cancels it.
func (s *Session) runTransfer(request protocol.Request) (any, error) {
	if s.deps.Transfer == nil {
		return nil, errors.New(UnsupportedOperation)
	}
	if request.Op == protocol.OpUpload {
		return result(s.deps.Transfer.Upload(s.connection, request.Path, request.Ticket))
	}
	return result(s.deps.Transfer.Download(s.connection, transfer.DownloadRequest{
		Path:      request.Path,
		Ticket:    request.Ticket,
		Size:      int64(request.Size),
		SHA256:    request.Sha256,
		Overwrite: request.Overwrite,
	}))
}

func (s *Session) runFS(request protocol.Request) (any, error) {
	fs := s.deps.FS
	switch request.Op {
	case protocol.OpRead:
		return result(fs.Read(request.Path, request.Offset, request.Limit))
	case protocol.OpStat:
		return result(fs.Stat(request.Path))
	case protocol.OpGlob:
		return result(fs.Glob(request.Path))
	case protocol.OpGrep:
		return result(fs.Grep(request.Root, request.Pattern))
	case protocol.OpFetch:
		from := 0.0
		if request.ChunkFrom != nil {
			from = *request.ChunkFrom
		}
		return result(fs.FetchChunk(request.Path, from))
	default:
		return nil, errors.New(UnsupportedOperation)
	}
}

func valueOf(text *string) string {
	if text == nil {
		return ""
	}
	return *text
}

func result[T any](value T, err error) (any, error) {
	if err != nil {
		return nil, err
	}
	return value, nil
}
