package transport

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type authority struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
	pool *x509.CertPool
}

func newAuthority(t *testing.T) authority {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test root"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return authority{cert: cert, key: key, pool: pool}
}

func (a authority) leaf(t *testing.T, serial int64, host string) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(serial),
		Subject:      pkix.Name{CommonName: host},
		DNSNames:     []string{host},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, a.cert, &key.PublicKey, a.key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func namedServer(t *testing.T, certificate tls.Certificate, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	server := httptest.NewUnstartedServer(handler)
	server.TLS = &tls.Config{Certificates: []tls.Certificate{certificate}}
	server.StartTLS()
	t.Cleanup(server.Close)
	return server
}

// clientResolving dials each host name to the listener the test assigned it,
// so certificates can name real hosts while the servers run on loopback.
func clientResolving(config *tls.Config, hosts map[string]*httptest.Server) *http.Client {
	dialer := &net.Dialer{}
	return &http.Client{Transport: &http.Transport{
		TLSClientConfig: config,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			if server, ok := hosts[host]; ok {
				address = server.Listener.Addr().String()
			}
			return dialer.DialContext(ctx, network, address)
		},
	}}
}

func TestAPerHostClientVerifiesEveryRedirectHopUnderItsOwnName(t *testing.T) {
	ca := newAuthority(t)
	assets := namedServer(t, ca.leaf(t, 2, "assets.test"), func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "binary")
	})
	releases := namedServer(t, ca.leaf(t, 3, "releases.test"), func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://assets.test/blob", http.StatusFound)
	})
	client := clientResolving(newTLSConfig("", x509.NewCertPool(), ca.pool), map[string]*httptest.Server{
		"releases.test": releases,
		"assets.test":   assets,
	})
	response, err := client.Get("https://releases.test/v1/asset.exe")
	if err != nil {
		t.Fatalf("the redirect across hosts failed: %v", err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if string(body) != "binary" {
		t.Fatalf("body %q", body)
	}
}

func TestAPerHostClientRefusesACertificateForAnotherHost(t *testing.T) {
	ca := newAuthority(t)
	releases := namedServer(t, ca.leaf(t, 2, "releases.test"), func(w http.ResponseWriter, r *http.Request) {})
	client := clientResolving(newTLSConfig("", x509.NewCertPool(), ca.pool), map[string]*httptest.Server{
		"impostor.test": releases,
	})
	_, err := client.Get("https://impostor.test/")
	if err == nil || !strings.Contains(err.Error(), "impostor.test") {
		t.Fatalf("a certificate for releases.test was accepted for impostor.test: %v", err)
	}
}

func TestAPerHostConfigRefusesAConnectionWithNoName(t *testing.T) {
	server, pool := tlsServer(t)
	if err := handshake(t, server, newTLSConfig("", x509.NewCertPool(), pool)); err == nil {
		t.Fatal("an IP host with no name to verify against was accepted")
	}
}

func TestAPinnedConfigStillVerifiesAnIPAddressHost(t *testing.T) {
	server, pool := tlsServer(t)
	if err := handshake(t, server, newTLSConfig("127.0.0.1", x509.NewCertPool(), pool)); err != nil {
		t.Fatalf("pinned IP verification failed: %v", err)
	}
}
