package transport

import (
	"crypto/tls"
	"crypto/x509"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
)

type serverConn struct {
	conn     *websocket.Conn
	received chan string
}

func newServer(t *testing.T, handle func(sc serverConn)) string {
	t.Helper()
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		handle(serverConn{conn: conn, received: make(chan string, 16)})
	}))
	t.Cleanup(server.Close)
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/beacon"
}

func waitClosed(t *testing.T, closed <-chan struct{}) {
	t.Helper()
	select {
	case <-closed:
	case <-time.After(10 * time.Second):
		t.Fatal("the close listener never fired")
	}
}

func closeSignal(socket Transport) <-chan struct{} {
	closed := make(chan struct{})
	var once sync.Once
	socket.OnClose(func() { once.Do(func() { close(closed) }) })
	return closed
}

func TestQueuesSendsWhileConnectingAndDeliversValidFramesOnly(t *testing.T) {
	gotHello := make(chan string, 1)
	url := newServer(t, func(sc serverConn) {
		_, data, err := sc.conn.ReadMessage()
		if err != nil {
			return
		}
		gotHello <- string(data)
		_ = sc.conn.WriteMessage(websocket.BinaryMessage, []byte(`{"kind":"ping"}`))
		_ = sc.conn.WriteMessage(websocket.TextMessage, []byte(`not json`))
		_ = sc.conn.WriteMessage(websocket.TextMessage, []byte(`{"kind":"teleport"}`))
		_ = sc.conn.WriteMessage(websocket.TextMessage, []byte(`{"kind":"challenge","nonce":"n1"}`))
		_, _, _ = sc.conn.ReadMessage()
	})
	socket := Dial(url)
	frames := make(chan protocol.Frame, 8)
	socket.OnFrame(func(frame protocol.Frame) { frames <- frame })
	closed := closeSignal(socket)
	socket.Send(protocol.Hello{BeaconID: "b1", ProtocolVersion: 2, BeaconVersion: "1", OS: protocol.OSWindows})
	select {
	case hello := <-gotHello:
		if hello != `{"kind":"hello","beaconId":"b1","protocolVersion":2,"beaconVersion":"1","os":"windows"}` {
			t.Fatalf("server received %s", hello)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the queued hello never arrived")
	}
	select {
	case frame := <-frames:
		if frame != (protocol.Challenge{Nonce: "n1"}) {
			t.Fatalf("first delivered frame = %#v; invalid frames must be dropped", frame)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("no frame delivered")
	}
	socket.Close()
	waitClosed(t, closed)
	socket.Send(protocol.Pong{})
}

func TestCloseListenersFireOnceWhenTheServerHangsUp(t *testing.T) {
	url := newServer(t, func(sc serverConn) {})
	socket := Dial(url)
	var mu sync.Mutex
	count := 0
	done := make(chan struct{})
	socket.OnClose(func() {
		mu.Lock()
		count++
		mu.Unlock()
		close(done)
	})
	waitClosed(t, done)
	socket.Close()
	late := closeSignal(socket)
	waitClosed(t, late)
	mu.Lock()
	defer mu.Unlock()
	if count != 1 {
		t.Fatalf("close listener fired %d times", count)
	}
}

func TestASilentLinkIsClosedAfterTheReadTimeout(t *testing.T) {
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	url := newServer(t, func(sc serverConn) { <-release })
	socket := dial(url, 200*time.Millisecond)
	waitClosed(t, closeSignal(socket))
}

func TestAnUnreachableServerClosesTheTransport(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	socket := Dial("ws://" + address + "/beacon")
	waitClosed(t, closeSignal(socket))
}

func TestClosingWhileConnectingFiresTheCloseListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	socket := Dial("ws://" + listener.Addr().String() + "/beacon")
	closed := closeSignal(socket)
	socket.Close()
	waitClosed(t, closed)
}

func tlsServer(t *testing.T) (*httptest.Server, *x509.CertPool) {
	t.Helper()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	t.Cleanup(server.Close)
	pool := x509.NewCertPool()
	pool.AddCert(server.Certificate())
	return server, pool
}

func handshake(t *testing.T, server *httptest.Server, config *tls.Config) error {
	t.Helper()
	conn, err := tls.Dial("tcp", server.Listener.Addr().String(), config)
	if err != nil {
		return err
	}
	return conn.Close()
}

func TestAChainUnknownToTheSystemIsTrustedThroughTheFallbackBundle(t *testing.T) {
	server, pool := tlsServer(t)
	if err := handshake(t, server, newTLSConfig("127.0.0.1", x509.NewCertPool(), pool)); err != nil {
		t.Fatalf("fallback verification failed: %v", err)
	}
}

func TestAChainUnknownToBothStoresIsRefused(t *testing.T) {
	server, _ := tlsServer(t)
	if err := handshake(t, server, newTLSConfig("127.0.0.1", x509.NewCertPool(), x509.NewCertPool())); err == nil {
		t.Fatal("an untrusted chain was accepted")
	}
}

func TestTheHostNameIsVerifiedEvenThroughTheFallback(t *testing.T) {
	server, pool := tlsServer(t)
	if err := handshake(t, server, newTLSConfig("kanna.invalid", x509.NewCertPool(), pool)); err == nil {
		t.Fatal("a certificate for another host was accepted")
	}
}

func TestTheSystemStoreIsTriedFirst(t *testing.T) {
	server, pool := tlsServer(t)
	if err := handshake(t, server, newTLSConfig("127.0.0.1", pool, x509.NewCertPool())); err != nil {
		t.Fatalf("system verification failed: %v", err)
	}
}

func TestTheEmbeddedBundleHoldsTheMozillaRoots(t *testing.T) {
	//lint:ignore SA1019 Subjects is the only way to count a pool on Go 1.20
	if got := len(mozillaPool().Subjects()); got < 100 {
		t.Fatalf("embedded bundle parsed to %d roots", got)
	}
}
