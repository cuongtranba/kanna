// Package keystore mirrors src/beacon/key-store.adapter.ts: the beacon's
// Ed25519 identity, kept as a PKCS#8 DER file shared with the Bun beacon.
package keystore

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// Store signs challenge nonces with the machine's private key.
type Store struct {
	privateKey ed25519.PrivateKey
	spkiBase64 string
}

// Open loads the key at path, creating a fresh one (mode 0600, parent
// directories included) when the file does not exist.
func Open(path string) (*Store, error) {
	key, err := loadOrCreate(path)
	if err != nil {
		return nil, err
	}
	return FromPrivateKey(key)
}

// FromPKCS8 builds a store from a PKCS#8 DER encoded Ed25519 key.
func FromPKCS8(der []byte) (*Store, error) {
	parsed, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		return nil, fmt.Errorf("keystore: parse key: %w", err)
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("keystore: key is not Ed25519")
	}
	return FromPrivateKey(key)
}

// FromPrivateKey builds a store from an Ed25519 private key.
func FromPrivateKey(key ed25519.PrivateKey) (*Store, error) {
	spki, err := x509.MarshalPKIXPublicKey(key.Public())
	if err != nil {
		return nil, fmt.Errorf("keystore: encode public key: %w", err)
	}
	return &Store{privateKey: key, spkiBase64: base64.StdEncoding.EncodeToString(spki)}, nil
}

// PublicKeySPKIBase64 is the public key as SPKI DER in padded standard base64.
func (s *Store) PublicKeySPKIBase64() string { return s.spkiBase64 }

// Sign signs the UTF-8 bytes of the nonce string itself (it is never base64
// decoded first) and returns the signature in padded standard base64.
func (s *Store) Sign(nonce string) string {
	return base64.StdEncoding.EncodeToString(ed25519.Sign(s.privateKey, []byte(nonce)))
}

// Erase deletes the key file; a missing file is not an error.
func Erase(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

func loadOrCreate(path string) (ed25519.PrivateKey, error) {
	der, err := os.ReadFile(path)
	if err == nil {
		store, parseErr := FromPKCS8(der)
		if parseErr != nil {
			return nil, parseErr
		}
		return store.privateKey, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o777); err != nil {
		return nil, err
	}
	if err := writeNew(path, encoded); err != nil {
		return nil, err
	}
	return key, nil
}

func writeNew(path string, data []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}
