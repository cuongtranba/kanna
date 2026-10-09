package transfer_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/fsops"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transfer"
)

const (
	ticket    = "ticket-token"
	chunkSize = 4096
)

// fakeKanna implements the beacon-facing half of the transfer HTTP table.
type fakeKanna struct {
	mu           sync.Mutex
	requests     int
	ranges       []string
	received     []byte
	source       []byte
	dropFirstAck bool
	revokeAfter  int
	served       int
	// resumeChecks, when set, is signalled on every resume-point request.
	resumeChecks chan struct{}
}

func (k *fakeKanna) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		k.mu.Lock()
		defer k.mu.Unlock()
		k.requests++
		if r.Header.Get("Authorization") != "Bearer "+ticket || !strings.HasPrefix(r.Header.Get("User-Agent"), "kanna-beacon/") {
			http.Error(w, "unknown ticket", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.Header.Get("Range") == "":
			if k.resumeChecks != nil {
				select {
				case k.resumeChecks <- struct{}{}:
				default:
				}
			}
			writeJSON(w, http.StatusOK, map[string]any{"direction": "upload", "received": len(k.received)})
		case r.Method == http.MethodGet:
			k.serveRange(w, r)
		case r.Method == http.MethodPut:
			k.acceptChunk(t, w, r)
		case r.Method == http.MethodPost && r.URL.Path == "/beacon/transfer/complete":
			k.complete(w, r)
		default:
			http.NotFound(w, r)
		}
	})
}

func (k *fakeKanna) serveRange(w http.ResponseWriter, r *http.Request) {
	if k.revokeAfter > 0 && k.served >= k.revokeAfter {
		http.Error(w, "ticket revoked", http.StatusUnauthorized)
		return
	}
	k.served++
	k.ranges = append(k.ranges, r.Header.Get("Range"))
	var first, last int
	if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &first, &last); err != nil {
		http.Error(w, "bad range", http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusPartialContent)
	_, _ = w.Write(k.source[first : last+1])
}

func (k *fakeKanna) acceptChunk(t *testing.T, w http.ResponseWriter, r *http.Request) {
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if offset != len(k.received) {
		writeJSON(w, http.StatusConflict, map[string]any{"received": len(k.received)})
		return
	}
	var body bytes.Buffer
	if _, err := io.Copy(&body, r.Body); err != nil {
		t.Errorf("reading chunk body: %v", err)
	}
	if int64(body.Len()) != r.ContentLength {
		t.Errorf("chunk body is %d bytes but Content-Length says %d", body.Len(), r.ContentLength)
	}
	k.received = append(k.received, body.Bytes()...)
	if k.dropFirstAck {
		k.dropFirstAck = false
		http.Error(w, "lost the acknowledgement", http.StatusBadGateway)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"received": len(k.received)})
}

func (k *fakeKanna) complete(w http.ResponseWriter, r *http.Request) {
	var claim struct {
		Bytes  int    `json:"bytes"`
		SHA256 string `json:"sha256"`
	}
	if err := json.NewDecoder(r.Body).Decode(&claim); err != nil || claim.Bytes != len(k.received) || claim.SHA256 != digestOf(k.received) {
		http.Error(w, "does not match", http.StatusUnprocessableEntity)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": "uploads/x", "bytes": claim.Bytes, "sha256": claim.SHA256})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func digestOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func sampleBytes(length int) []byte {
	data := make([]byte, length)
	for index := range data {
		data[index] = byte(index*31 + index/251)
	}
	return data
}

type rig struct {
	kanna      *fakeKanna
	transferer *transfer.Transferer
	dir        string
	sleeps     []time.Duration
}

func newRig(t *testing.T, kanna *fakeKanna, configure ...func(*transfer.Config)) *rig {
	t.Helper()
	dir, err := fsops.Realpath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(kanna.handler(t))
	t.Cleanup(server.Close)
	r := &rig{kanna: kanna, dir: dir}
	roots := func() []string { return []string{dir} }
	cfg := transfer.Config{
		BaseURL:     server.URL + "/",
		ContainRead: fsops.New(roots).Contain,
		WriteRoots:  roots,
		Client:      server.Client(),
		ChunkBytes:  chunkSize,
		Sleep: func(_ context.Context, d time.Duration) error {
			r.sleeps = append(r.sleeps, d)
			return nil
		},
	}
	for _, apply := range configure {
		apply(&cfg)
	}
	r.transferer = transfer.New(cfg)
	return r
}

func TestUploadResumesFromTheServersByteCountAfterAConflict(t *testing.T) {
	kanna := &fakeKanna{dropFirstAck: true}
	r := newRig(t, kanna)
	content := sampleBytes(2*chunkSize + 123)
	path := filepath.Join(r.dir, "book.xlsx")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := r.transferer.Upload(context.Background(), path, ticket)
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}

	if !bytes.Equal(kanna.received, content) {
		t.Fatalf("kanna holds %d bytes that differ from the %d byte file", len(kanna.received), len(content))
	}
	if result.Bytes != int64(len(content)) || result.SHA256 != digestOf(content) || result.Path != path {
		t.Fatalf("result = %#v", result)
	}
	if len(r.sleeps) != 1 || r.sleeps[0] != time.Second {
		t.Fatalf("expected one 1s backoff after the lost acknowledgement, slept %v", r.sleeps)
	}
}

func TestUploadKeepsTheTicketAliveWhileTheHashIsSlow(t *testing.T) {
	kanna := &fakeKanna{resumeChecks: make(chan struct{}, 1)}
	r := newRig(t, kanna, func(cfg *transfer.Config) {
		cfg.KeepAliveInterval = time.Millisecond
		cfg.Hash = func(file io.ReaderAt, size int64) (string, error) {
			select {
			case <-kanna.resumeChecks:
			case <-time.After(10 * time.Second):
				return "", errors.New("no keep-alive reached kanna while the hash ran")
			}
			digest := sha256.New()
			if _, err := io.Copy(digest, io.NewSectionReader(file, 0, size)); err != nil {
				return "", err
			}
			return hex.EncodeToString(digest.Sum(nil)), nil
		}
	})
	content := sampleBytes(chunkSize + 7)
	path := filepath.Join(r.dir, "big.iso")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}

	result, err := r.transferer.Upload(context.Background(), path, ticket)
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}

	if !bytes.Equal(kanna.received, content) || result.SHA256 != digestOf(content) {
		t.Fatalf("the upload after a kept-alive hash is wrong: result %#v", result)
	}
}

func TestDownloadFetchesEachRangeThenVerifiesAndReplacesTheDestination(t *testing.T) {
	content := sampleBytes(2*chunkSize + 1000)
	kanna := &fakeKanna{source: content}
	r := newRig(t, kanna)
	destination := filepath.Join(r.dir, "nested", "book.xlsx")

	result, err := r.transferer.Download(context.Background(), transfer.DownloadRequest{
		Path: destination, Ticket: ticket, Size: int64(len(content)), SHA256: digestOf(content),
	})
	if err != nil {
		t.Fatalf("Download: %v", err)
	}

	got, err := os.ReadFile(destination)
	if err != nil || !bytes.Equal(got, content) {
		t.Fatalf("destination differs from the source (read error %v)", err)
	}
	wantRanges := []string{"bytes=0-4095", "bytes=4096-8191", "bytes=8192-9191"}
	if strings.Join(kanna.ranges, ",") != strings.Join(wantRanges, ",") {
		t.Fatalf("ranges = %v, want %v", kanna.ranges, wantRanges)
	}
	if result.Path != destination || result.Bytes != int64(len(content)) || result.SHA256 != digestOf(content) {
		t.Fatalf("result = %#v", result)
	}
	if _, err := os.Stat(destination + transfer.PartSuffix); !os.IsNotExist(err) {
		t.Fatalf("the part file survived the rename: %v", err)
	}
}

func TestDownloadAbortsOnARevokedTicketAndLeavesNoFiles(t *testing.T) {
	content := sampleBytes(3 * chunkSize)
	kanna := &fakeKanna{source: content, revokeAfter: 1}
	r := newRig(t, kanna)
	destination := filepath.Join(r.dir, "book.xlsx")

	_, err := r.transferer.Download(context.Background(), transfer.DownloadRequest{
		Path: destination, Ticket: ticket, Size: int64(len(content)), SHA256: digestOf(content),
	})

	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("expected a 401 failure, got %v", err)
	}
	if kanna.requests != 2 || len(r.sleeps) != 0 {
		t.Fatalf("a 401 must not be retried: %d requests, sleeps %v", kanna.requests, r.sleeps)
	}
	if entries, _ := os.ReadDir(r.dir); len(entries) != 0 {
		t.Fatalf("a failed download left %d entries behind", len(entries))
	}
}

func TestDownloadWithTheWrongSha256LeavesNoDestination(t *testing.T) {
	content := sampleBytes(chunkSize + 10)
	r := newRig(t, &fakeKanna{source: content})
	destination := filepath.Join(r.dir, "book.xlsx")

	_, err := r.transferer.Download(context.Background(), transfer.DownloadRequest{
		Path: destination, Ticket: ticket, Size: int64(len(content)), SHA256: digestOf([]byte("something else")),
	})

	if err == nil || !strings.Contains(err.Error(), "sha256 mismatch") {
		t.Fatalf("expected a sha256 mismatch, got %v", err)
	}
	if entries, _ := os.ReadDir(r.dir); len(entries) != 0 {
		t.Fatalf("a rejected download left %d entries behind", len(entries))
	}
}

func TestDownloadRefusesAnExistingFileUnlessOverwriteIsSet(t *testing.T) {
	content := sampleBytes(100)
	kanna := &fakeKanna{source: content}
	r := newRig(t, kanna)
	destination := filepath.Join(r.dir, "book.xlsx")
	if err := os.WriteFile(destination, []byte("precious"), 0o644); err != nil {
		t.Fatal(err)
	}
	request := transfer.DownloadRequest{Path: destination, Ticket: ticket, Size: int64(len(content)), SHA256: digestOf(content)}

	if _, err := r.transferer.Download(context.Background(), request); err == nil {
		t.Fatal("overwrite=false replaced an existing file")
	}
	if got, _ := os.ReadFile(destination); string(got) != "precious" || kanna.requests != 0 {
		t.Fatalf("the refusal must not touch the file or the network: content %q, %d requests", got, kanna.requests)
	}

	request.Overwrite = true
	if _, err := r.transferer.Download(context.Background(), request); err != nil {
		t.Fatalf("overwrite=true: %v", err)
	}
	if got, _ := os.ReadFile(destination); !bytes.Equal(got, content) {
		t.Fatal("overwrite=true did not replace the file")
	}
}

func TestDownloadOutsideTheWriteRootsIsRefusedBeforeAnyRequest(t *testing.T) {
	kanna := &fakeKanna{source: sampleBytes(10)}
	r := newRig(t, kanna)
	outside := filepath.Join(filepath.Dir(r.dir), "elsewhere.bin")

	_, err := r.transferer.Download(context.Background(), transfer.DownloadRequest{
		Path: outside, Ticket: ticket, Size: 10, SHA256: digestOf(kanna.source),
	})

	if err == nil || !strings.Contains(err.Error(), "write roots") || kanna.requests != 0 {
		t.Fatalf("expected a write-roots refusal with no request, got %v after %d requests", err, kanna.requests)
	}
	if _, statErr := os.Stat(outside + transfer.PartSuffix); !os.IsNotExist(statErr) {
		t.Fatal("a part file was created outside the write roots")
	}
}
