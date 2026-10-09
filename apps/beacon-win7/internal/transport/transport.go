// Package transport mirrors src/beacon/transport.adapter.ts: one JSON frame
// per WebSocket text message, sends queued while connecting, invalid server
// frames dropped silently, and close listeners fired exactly once.
package transport

import (
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
)

// ReadTimeout closes a connection that has delivered nothing, not even a
// WebSocket ping, for this long. The server pings every 15 s, so it only
// fires on a dead link, which the runner then replaces.
const ReadTimeout = 60 * time.Second

const (
	writeTimeout     = 10 * time.Second
	handshakeTimeout = 30 * time.Second
)

// Transport is the connection a session speaks over.
type Transport interface {
	Send(frame protocol.Frame)
	OnFrame(listener func(protocol.Frame))
	OnClose(listener func())
	Close()
}

type phase int

const (
	phaseConnecting phase = iota
	phaseOpen
	phaseClosed
)

// WebSocket is a Transport over a gorilla/websocket client connection.
type WebSocket struct {
	readTimeout time.Duration

	mu             sync.Mutex
	writeMu        sync.Mutex
	phase          phase
	conn           *websocket.Conn
	pending        [][]byte
	frameListeners []func(protocol.Frame)
	closeListeners []func()
	closed         bool
}

// Dial starts connecting to rawURL and returns at once, like `new WebSocket`.
func Dial(rawURL string) *WebSocket {
	return dial(rawURL, ReadTimeout)
}

func dial(rawURL string, readTimeout time.Duration) *WebSocket {
	socket := &WebSocket{readTimeout: readTimeout}
	go socket.connect(rawURL)
	return socket
}

func (w *WebSocket) connect(rawURL string) {
	dialer := websocket.Dialer{
		Proxy:            http.ProxyFromEnvironment,
		HandshakeTimeout: handshakeTimeout,
	}
	if parsed, err := url.Parse(rawURL); err == nil && parsed.Scheme == "wss" {
		dialer.TLSClientConfig = TLSConfig(parsed.Hostname())
	}
	conn, response, err := dialer.Dial(rawURL, nil)
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	if err != nil {
		w.finish()
		return
	}
	w.mu.Lock()
	if w.phase == phaseClosed {
		w.mu.Unlock()
		conn.Close()
		w.finish()
		return
	}
	w.writeMu.Lock()
	w.conn = conn
	w.phase = phaseOpen
	pending := w.pending
	w.pending = nil
	w.mu.Unlock()
	for _, message := range pending {
		w.writeLocked(conn, message)
	}
	w.writeMu.Unlock()
	w.readLoop(conn)
}

func (w *WebSocket) readLoop(conn *websocket.Conn) {
	defer w.finish()
	extend := func() { _ = conn.SetReadDeadline(time.Now().Add(w.readTimeout)) }
	conn.SetPingHandler(func(data string) error {
		extend()
		return conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(writeTimeout))
	})
	for {
		extend()
		kind, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if kind != websocket.TextMessage {
			continue
		}
		frame, ok := protocol.ParseFrame(data)
		if !ok {
			continue
		}
		w.mu.Lock()
		listeners := append([]func(protocol.Frame){}, w.frameListeners...)
		w.mu.Unlock()
		for _, listener := range listeners {
			listener(frame)
		}
	}
}

func (w *WebSocket) finish() {
	w.mu.Lock()
	w.phase = phaseClosed
	conn := w.conn
	if w.closed {
		w.mu.Unlock()
		return
	}
	w.closed = true
	listeners := w.closeListeners
	w.closeListeners = nil
	w.mu.Unlock()
	if conn != nil {
		conn.Close()
	}
	for _, listener := range listeners {
		listener()
	}
}

func (w *WebSocket) write(message []byte) {
	w.mu.Lock()
	conn := w.conn
	w.mu.Unlock()
	if conn == nil {
		return
	}
	w.writeMu.Lock()
	defer w.writeMu.Unlock()
	w.writeLocked(conn, message)
}

func (w *WebSocket) writeLocked(conn *websocket.Conn, message []byte) {
	_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	if err := conn.WriteMessage(websocket.TextMessage, message); err != nil {
		conn.Close()
	}
}

// Send encodes frame and writes it, queues it while connecting, and drops it
// once the connection is closing or closed.
func (w *WebSocket) Send(frame protocol.Frame) {
	message, err := protocol.Encode(frame)
	if err != nil {
		return
	}
	w.mu.Lock()
	switch w.phase {
	case phaseConnecting:
		w.pending = append(w.pending, message)
		w.mu.Unlock()
	case phaseOpen:
		w.mu.Unlock()
		w.write(message)
	default:
		w.mu.Unlock()
	}
}

// OnFrame registers a listener for every valid frame the server sends.
func (w *WebSocket) OnFrame(listener func(protocol.Frame)) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.frameListeners = append(w.frameListeners, listener)
}

// OnClose registers a listener fired once when the connection ends. A
// listener registered after the end fires immediately.
func (w *WebSocket) OnClose(listener func()) {
	w.mu.Lock()
	if !w.closed {
		w.closeListeners = append(w.closeListeners, listener)
		w.mu.Unlock()
		return
	}
	w.mu.Unlock()
	listener()
}

// Close ends the connection, sending a close frame when it is open.
func (w *WebSocket) Close() {
	w.mu.Lock()
	previous := w.phase
	w.phase = phaseClosed
	conn := w.conn
	w.mu.Unlock()
	switch {
	case previous == phaseConnecting:
		w.finish()
	case previous == phaseOpen && conn != nil:
		_ = conn.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
			time.Now().Add(writeTimeout),
		)
		conn.Close()
	}
}
