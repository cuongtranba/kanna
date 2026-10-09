package keystore_test

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/keystore"
)

func verify(t *testing.T, spkiBase64, nonce, signatureBase64 string) bool {
	t.Helper()
	spki, err := base64.StdEncoding.DecodeString(spkiBase64)
	if err != nil {
		t.Fatal(err)
	}
	public, err := x509.ParsePKIXPublicKey(spki)
	if err != nil {
		t.Fatal(err)
	}
	signature, err := base64.StdEncoding.DecodeString(signatureBase64)
	if err != nil {
		t.Fatal(err)
	}
	return ed25519.Verify(public.(ed25519.PublicKey), []byte(nonce), signature)
}

func TestSignsANonceAndKeepsTheSameIdentityAcrossLoads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "key.der")
	first, err := keystore.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	signature := first.Sign("challenge-nonce")
	if !verify(t, first.PublicKeySPKIBase64(), "challenge-nonce", signature) {
		t.Fatal("signature does not verify")
	}
	if verify(t, first.PublicKeySPKIBase64(), "other-nonce", signature) {
		t.Fatal("signature verified for a different nonce")
	}
	reloaded, err := keystore.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.PublicKeySPKIBase64() != first.PublicKeySPKIBase64() {
		t.Fatal("reloading the key changed the identity")
	}
	der, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(der) != 48 {
		t.Fatalf("PKCS#8 Ed25519 key is %d bytes, want 48", len(der))
	}
}

func TestWritesTheKeyReadableByTheOwnerOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("file modes are not meaningful on Windows")
	}
	path := filepath.Join(t.TempDir(), "key.der")
	if _, err := keystore.Open(path); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("key mode = %o, want 600", mode)
	}
}

func TestErasingTheKeyGivesTheMachineANewIdentity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key.der")
	before, err := keystore.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := keystore.Erase(path); err != nil {
		t.Fatal(err)
	}
	if err := keystore.Erase(path); err != nil {
		t.Fatalf("erasing a missing key failed: %v", err)
	}
	after, err := keystore.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if after.PublicKeySPKIBase64() == before.PublicKeySPKIBase64() {
		t.Fatal("a new key was not generated")
	}
}

func TestSignatureConformance(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "conformance", "signature.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		PKCS8Base64     string `json:"pkcs8Base64"`
		Nonce           string `json:"nonce"`
		SPKIBase64      string `json:"spkiBase64"`
		SignatureBase64 string `json:"signatureBase64"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	der, err := base64.StdEncoding.DecodeString(fixture.PKCS8Base64)
	if err != nil {
		t.Fatal(err)
	}
	store, err := keystore.FromPKCS8(der)
	if err != nil {
		t.Fatal(err)
	}
	if got := store.PublicKeySPKIBase64(); got != fixture.SPKIBase64 {
		t.Fatalf("SPKI = %s, want %s", got, fixture.SPKIBase64)
	}
	if got := store.Sign(fixture.Nonce); got != fixture.SignatureBase64 {
		t.Fatalf("signature = %s, want %s", got, fixture.SignatureBase64)
	}
	path := filepath.Join(t.TempDir(), "key.der")
	if err := os.WriteFile(path, der, 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := keystore.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.PublicKeySPKIBase64() != fixture.SPKIBase64 {
		t.Fatal("a key file written by the Bun beacon must load to the same identity")
	}
}
