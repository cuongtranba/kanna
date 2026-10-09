package transport

import (
	"crypto/tls"
	"crypto/x509"
	_ "embed"
	"errors"
	"net/http"
	"sync"
	"time"
)

// mozillaRoots is curl's extract of the Mozilla CA store (see README for its
// date). An un-updated Windows 7 lacks newer roots such as ISRG Root X1, so a
// chain the system store cannot place is retried against this bundle.
//
//go:embed cacert.pem
var mozillaRoots []byte

var (
	fallbackOnce sync.Once
	fallbackPool *x509.CertPool
)

func mozillaPool() *x509.CertPool {
	fallbackOnce.Do(func() {
		fallbackPool = x509.NewCertPool()
		fallbackPool.AppendCertsFromPEM(mozillaRoots)
	})
	return fallbackPool
}

// TLSConfig verifies a server's chain and its name against the system roots,
// and when the system store rejects the chain, against the embedded Mozilla
// bundle.
func TLSConfig(serverName string) *tls.Config {
	return newTLSConfig(serverName, nil, mozillaPool())
}

// newTLSConfig takes the root pools explicitly; a nil system pool means the
// operating system's verifier. InsecureSkipVerify only disables crypto/tls's
// built-in check so VerifyConnection can run the two-step check above; that
// check still verifies the full chain, validity and host name.
func newTLSConfig(serverName string, system, fallback *x509.CertPool) *tls.Config {
	return &tls.Config{
		ServerName:         serverName,
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: true, //nolint:gosec // replaced by VerifyConnection below
		VerifyConnection: func(state tls.ConnectionState) error {
			return verifyPeer(state, serverName, system, fallback)
		},
	}
}

func verifyPeer(state tls.ConnectionState, serverName string, system, fallback *x509.CertPool) error {
	if len(state.PeerCertificates) == 0 {
		return errors.New("tls: server presented no certificate")
	}
	if serverName == "" {
		return errors.New("tls: no server name to verify against")
	}
	intermediates := x509.NewCertPool()
	for _, certificate := range state.PeerCertificates[1:] {
		intermediates.AddCert(certificate)
	}
	options := x509.VerifyOptions{
		DNSName:       serverName,
		Intermediates: intermediates,
		Roots:         system,
		CurrentTime:   time.Now(),
	}
	leaf := state.PeerCertificates[0]
	_, err := leaf.Verify(options)
	if err == nil || fallback == nil {
		return err
	}
	// Any system failure retries against the bundle, not only an unknown
	// authority: an un-updated Windows 7 can also build a chain to an expired
	// root it does know (DST Root CA X3) and report that as a validity error.
	// The retry enforces the same chain, validity and host-name checks.
	options.Roots = fallback
	if _, fallbackErr := leaf.Verify(options); fallbackErr != nil {
		return err
	}
	return nil
}

// HTTPClient returns a client for one Kanna host with the same verification.
func HTTPClient(serverName string) *http.Client {
	return &http.Client{
		Timeout: 60 * time.Second,
		Transport: &http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			TLSClientConfig:     TLSConfig(serverName),
			TLSHandshakeTimeout: 30 * time.Second,
		},
	}
}
