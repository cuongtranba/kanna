// Package protocol mirrors src/shared/beacon-protocol.ts: the frames a beacon
// and the Kanna server exchange, their JSON encoding, and the parser that
// decides which frames are well formed.
package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Protocol versions, identical to the TypeScript constants.
const (
	BeaconProtocolVersion = 3
	MinBeaconProtocol     = 1
	ScopeSyncProtocol     = 2
	TransferProtocol      = 3
)

// Operating systems a beacon may announce.
const (
	OSDarwin  = "darwin"
	OSLinux   = "linux"
	OSWindows = "windows"
)

// Refusal reasons the server may send.
const (
	RefusalUnknownBeacon = "unknown-beacon"
	RefusalDisabled      = "disabled"
)

// Frame kinds.
const (
	KindHello        = "hello"
	KindIncompatible = "incompatible"
	KindChallenge    = "challenge"
	KindAuth         = "auth"
	KindReady        = "ready"
	KindRefused      = "refused"
	KindScope        = "scope"
	KindSetScope     = "set-scope"
	KindUnpair       = "unpair"
	KindPing         = "ping"
	KindPong         = "pong"
	KindRequest      = "request"
	KindStdout       = "stdout"
	KindStderr       = "stderr"
	KindExit         = "exit"
	KindResult       = "result"
	KindError        = "error"
)

// Request operations.
const (
	OpExec   = "exec"
	OpScript = "script"
	OpRead   = "read"
	OpGrep   = "grep"
	OpFetch  = "fetch"
	OpStat   = "stat"
	OpGlob   = "glob"

	OpUpload   = "upload"
	OpDownload = "download"
)

// IsSupportedProtocol reports whether version lies inside the supported window.
func IsSupportedProtocol(version float64) bool {
	return version >= MinBeaconProtocol && version <= BeaconProtocolVersion
}

// Frame is one protocol message. Kind returns the value of its "kind" key.
type Frame interface {
	Kind() string
}

// Scope is the grant the server sends in ready and scope frames.
type Scope struct {
	Exec                bool     `json:"exec"`
	ExecAllowlist       []string `json:"execAllowlist"`
	AutoRunScripts      bool     `json:"autoRunScripts"`
	TrustedScriptHashes []string `json:"trustedScriptHashes"`
	ReadRoots           []string `json:"readRoots"`
	WriteRoots          []string `json:"writeRoots"`
	PerCallTimeoutMs    float64  `json:"perCallTimeoutMs"`
	OutputByteCap       float64  `json:"outputByteCap"`
	MaxConcurrent       float64  `json:"maxConcurrent"`
}

// ScopeChange is the partial scope a beacon asks the server to apply.
// A nil field is absent from the encoded frame.
type ScopeChange struct {
	ReadRoots      *[]string `json:"readRoots,omitempty"`
	Exec           *bool     `json:"exec,omitempty"`
	AutoRunScripts *bool     `json:"autoRunScripts,omitempty"`
}

// Request is the operation inside a request frame. Only the fields of its Op
// are meaningful.
type Request struct {
	Op        string
	Cmd       string
	Args      []string
	Cwd       *string
	Body      string
	Path      string
	Offset    float64
	Limit     float64
	Root      string
	Pattern   string
	ChunkFrom *float64
	Ticket    string
	Size      float64
	Sha256    string
	Overwrite bool
}

// MarshalJSON encodes the request with the keys its op carries, in the order
// the TypeScript parser produces them.
func (r Request) MarshalJSON() ([]byte, error) {
	switch r.Op {
	case OpExec:
		args := r.Args
		if args == nil {
			args = []string{}
		}
		return marshal(struct {
			Op   string   `json:"op"`
			Cmd  string   `json:"cmd"`
			Args []string `json:"args"`
			Cwd  *string  `json:"cwd,omitempty"`
		}{r.Op, r.Cmd, args, r.Cwd})
	case OpScript:
		return marshal(struct {
			Op   string `json:"op"`
			Body string `json:"body"`
		}{r.Op, r.Body})
	case OpRead:
		return marshal(struct {
			Op     string  `json:"op"`
			Path   string  `json:"path"`
			Offset float64 `json:"offset"`
			Limit  float64 `json:"limit"`
		}{r.Op, r.Path, r.Offset, r.Limit})
	case OpGrep:
		return marshal(struct {
			Op      string `json:"op"`
			Root    string `json:"root"`
			Pattern string `json:"pattern"`
		}{r.Op, r.Root, r.Pattern})
	case OpFetch:
		return marshal(struct {
			Op        string   `json:"op"`
			Path      string   `json:"path"`
			ChunkFrom *float64 `json:"chunkFrom,omitempty"`
		}{r.Op, r.Path, r.ChunkFrom})
	case OpStat, OpGlob:
		return marshal(struct {
			Op   string `json:"op"`
			Path string `json:"path"`
		}{r.Op, r.Path})
	case OpUpload:
		return marshal(struct {
			Op     string `json:"op"`
			Path   string `json:"path"`
			Ticket string `json:"ticket"`
		}{r.Op, r.Path, r.Ticket})
	case OpDownload:
		return marshal(struct {
			Op        string  `json:"op"`
			Path      string  `json:"path"`
			Ticket    string  `json:"ticket"`
			Size      float64 `json:"size"`
			Sha256    string  `json:"sha256"`
			Overwrite bool    `json:"overwrite"`
		}{r.Op, r.Path, r.Ticket, r.Size, r.Sha256, r.Overwrite})
	default:
		return nil, fmt.Errorf("protocol: unknown request op %q", r.Op)
	}
}

// Hello is the beacon's first frame.
type Hello struct {
	BeaconID        string  `json:"beaconId"`
	ProtocolVersion float64 `json:"protocolVersion"`
	BeaconVersion   string  `json:"beaconVersion"`
	OS              string  `json:"os"`
}

// Incompatible tells the beacon its protocol is too old.
type Incompatible struct {
	MinSupported float64 `json:"minSupported"`
	DownloadURL  *string `json:"downloadUrl,omitempty"`
}

// Challenge carries the nonce the beacon must sign.
type Challenge struct {
	Nonce string `json:"nonce"`
}

// Auth carries the signed nonce.
type Auth struct {
	Signature string `json:"signature"`
}

// Ready completes the handshake and grants a scope.
type Ready struct {
	Scope           Scope    `json:"scope"`
	ProtocolVersion *float64 `json:"protocolVersion,omitempty"`
}

// Refused ends the handshake with a reason.
type Refused struct {
	Reason string `json:"reason"`
}

// ScopeFrame replaces the granted scope.
type ScopeFrame struct {
	Scope Scope `json:"scope"`
}

// SetScope asks the server to change the scope.
type SetScope struct {
	Change ScopeChange `json:"change"`
}

// Unpair asks the server to forget this beacon.
type Unpair struct{}

// Ping is the keep-alive probe.
type Ping struct{}

// Pong answers a ping.
type Pong struct{}

// RequestFrame asks the beacon to perform one operation.
type RequestFrame struct {
	ID      string  `json:"id"`
	Request Request `json:"request"`
}

// Stdout streams a command's standard output.
type Stdout struct {
	ID    string `json:"id"`
	Chunk string `json:"chunk"`
}

// Stderr streams a command's standard error.
type Stderr struct {
	ID    string `json:"id"`
	Chunk string `json:"chunk"`
}

// Exit reports a command's exit code.
type Exit struct {
	ID   string  `json:"id"`
	Code float64 `json:"code"`
}

// Result carries a filesystem operation's answer. Result is always encoded,
// as null when nil.
type Result struct {
	ID     string `json:"id"`
	Result any    `json:"result"`
}

// ErrorFrame reports a failed request.
type ErrorFrame struct {
	ID      string `json:"id"`
	Message string `json:"message"`
}

func (Hello) Kind() string        { return KindHello }
func (Incompatible) Kind() string { return KindIncompatible }
func (Challenge) Kind() string    { return KindChallenge }
func (Auth) Kind() string         { return KindAuth }
func (Ready) Kind() string        { return KindReady }
func (Refused) Kind() string      { return KindRefused }
func (ScopeFrame) Kind() string   { return KindScope }
func (SetScope) Kind() string     { return KindSetScope }
func (Unpair) Kind() string       { return KindUnpair }
func (Ping) Kind() string         { return KindPing }
func (Pong) Kind() string         { return KindPong }
func (RequestFrame) Kind() string { return KindRequest }
func (Stdout) Kind() string       { return KindStdout }
func (Stderr) Kind() string       { return KindStderr }
func (Exit) Kind() string         { return KindExit }
func (Result) Kind() string       { return KindResult }
func (ErrorFrame) Kind() string   { return KindError }

// Encode renders a frame as one compact JSON object whose first key is
// "kind", the shape JSON.stringify gives the TypeScript frames.
func Encode(frame Frame) ([]byte, error) {
	body, err := marshal(frame)
	if err != nil {
		return nil, err
	}
	kind, err := marshal(frame.Kind())
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	out.WriteString(`{"kind":`)
	out.Write(kind)
	if len(body) > 2 {
		out.WriteByte(',')
		out.Write(body[1:])
	} else {
		out.WriteByte('}')
	}
	return out.Bytes(), nil
}

func marshal(value any) ([]byte, error) {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimRight(out.Bytes(), "\n"), nil
}
