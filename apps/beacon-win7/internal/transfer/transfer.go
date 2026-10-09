// Package transfer moves one file between this machine and Kanna over HTTP,
// authorized by a one-file ticket instead of a login. The file is streamed in
// fixed-size chunks and is never held in memory; the bytes never cross the
// beacon WebSocket.
package transfer

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
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/fsops"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transport"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/version"
)

// Constants mirrored from src/shared/beacon-transfer.ts.
const (
	DefaultChunkBytes     = 8 << 20
	ChunkAttempts         = 5
	PartSuffix            = ".kanna-part"
	DefaultRequestTimeout = 10 * time.Minute
	// DefaultKeepAliveInterval mirrors TRANSFER_KEEPALIVE_MS: hashing a large
	// file sends no traffic, and Kanna idles a silent ticket out after 120 s.
	DefaultKeepAliveInterval = 30 * time.Second

	maxBackoff      = 16 * time.Second
	copyBufferBytes = 256 << 10
	maxResyncs      = 32
	maxBodyBytes    = 1 << 20
	maxDetailBytes  = 512
	endpoint        = "/beacon/transfer"
)

// Result is what a finished transfer reports to Kanna.
type Result struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

// DownloadRequest describes a file Kanna is sending to this machine.
type DownloadRequest struct {
	Path      string
	Ticket    string
	Size      int64
	SHA256    string
	Overwrite bool
}

// Config wires a Transferer. Only BaseURL, ContainRead and WriteRoots are
// required.
type Config struct {
	// BaseURL is the Kanna URL the beacon is paired with.
	BaseURL string
	// Version is reported in the User-Agent; it defaults to the build version.
	Version string
	// ContainRead resolves a path inside the read roots or refuses it.
	ContainRead func(path string) (string, error)
	// WriteRoots returns the folders downloads may write into, read on every
	// transfer so a scope change applies at once.
	WriteRoots func() []string
	// Client defaults to one verifying Kanna's certificate with no
	// whole-request timeout, because a body may legitimately take minutes.
	Client *http.Client
	// ChunkBytes defaults to DefaultChunkBytes.
	ChunkBytes int64
	// RequestTimeout bounds each chunk request; it defaults to ten minutes.
	RequestTimeout time.Duration
	// Sleep waits between retries; tests replace it so they never wait.
	Sleep func(ctx context.Context, d time.Duration) error
	// KeepAliveInterval spaces the requests that keep the ticket alive while
	// a hash runs; it defaults to DefaultKeepAliveInterval.
	KeepAliveInterval time.Duration
	// Hash digests the first size bytes of file; it defaults to a streaming
	// sha256, and tests replace it to make hashing slow enough to observe.
	Hash func(file io.ReaderAt, size int64) (string, error)
}

// Transferer performs uploads and downloads for one paired Kanna.
type Transferer struct {
	base           string
	userAgent      string
	containRead    func(path string) (string, error)
	writeRoots     func() []string
	client         *http.Client
	chunkBytes     int64
	requestTimeout time.Duration
	sleep          func(ctx context.Context, d time.Duration) error
	keepAlive      time.Duration
	hash           func(file io.ReaderAt, size int64) (string, error)
}

// New returns a Transferer for cfg.
func New(cfg Config) *Transferer {
	t := &Transferer{
		base:           strings.TrimRight(cfg.BaseURL, "/"),
		userAgent:      "kanna-beacon/" + valueOr(cfg.Version, version.Version),
		containRead:    cfg.ContainRead,
		writeRoots:     cfg.WriteRoots,
		client:         cfg.Client,
		chunkBytes:     cfg.ChunkBytes,
		requestTimeout: cfg.RequestTimeout,
		sleep:          cfg.Sleep,
		keepAlive:      cfg.KeepAliveInterval,
		hash:           cfg.Hash,
	}
	if t.client == nil {
		t.client = newClient(cfg.BaseURL)
	}
	if t.chunkBytes <= 0 {
		t.chunkBytes = DefaultChunkBytes
	}
	if t.requestTimeout <= 0 {
		t.requestTimeout = DefaultRequestTimeout
	}
	if t.sleep == nil {
		t.sleep = sleepContext
	}
	if t.keepAlive <= 0 {
		t.keepAlive = DefaultKeepAliveInterval
	}
	if t.hash == nil {
		t.hash = hashSection
	}
	return t
}

func valueOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// newClient is not transport.HTTPClient: that client's 60 s Timeout covers the
// response body, which would cut every large chunk short.
func newClient(baseURL string) *http.Client {
	host := ""
	if parsed, err := url.Parse(baseURL); err == nil {
		host = parsed.Hostname()
	}
	return &http.Client{
		Transport: &http.Transport{
			Proxy:               http.ProxyFromEnvironment,
			TLSClientConfig:     transport.TLSConfig(host),
			TLSHandshakeTimeout: 30 * time.Second,
		},
	}
}

func sleepContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// permanentError is a failure no retry can fix.
type permanentError struct{ err error }

func (e permanentError) Error() string { return e.err.Error() }
func (e permanentError) Unwrap() error { return e.err }

func permanent(format string, args ...any) error {
	return permanentError{err: fmt.Errorf(format, args...)}
}

// resyncError means Kanna holds a different number of bytes than the beacon
// assumed, and the upload should continue from there.
type resyncError struct{ received int64 }

func (e *resyncError) Error() string {
	return fmt.Sprintf("kanna holds %d bytes", e.received)
}

func backoff(attempt int) time.Duration {
	delay := time.Second << uint(attempt-1)
	if delay > maxBackoff || delay <= 0 {
		return maxBackoff
	}
	return delay
}

func (t *Transferer) withRetry(ctx context.Context, attempt func() error) error {
	var last error
	for number := 1; number <= ChunkAttempts; number++ {
		err := attempt()
		if err == nil {
			return nil
		}
		var fatal permanentError
		var resync *resyncError
		if errors.As(err, &fatal) || errors.As(err, &resync) {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		last = err
		if number < ChunkAttempts {
			if err := t.sleep(ctx, backoff(number)); err != nil {
				return err
			}
		}
	}
	return fmt.Errorf("gave up after %d attempts: %w", ChunkAttempts, last)
}

type call struct {
	method string
	url    string
	header map[string]string
	// body returns a fresh reader for every send; length is its size.
	body   func() io.Reader
	length int64
}

// do sends one request under its own deadline and hands the response to
// handle, which must also reject a status it does not expect.
func (t *Transferer) do(ctx context.Context, c call, handle func(*http.Response) error) error {
	ctx, cancel := context.WithTimeout(ctx, t.requestTimeout)
	defer cancel()
	var body io.Reader
	if c.body != nil {
		body = c.body()
	}
	request, err := http.NewRequestWithContext(ctx, c.method, c.url, body)
	if err != nil {
		return permanent("bad request to kanna: %v", err)
	}
	if c.body != nil {
		request.ContentLength = c.length
		request.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(c.body()), nil }
	}
	request.Header.Set("User-Agent", t.userAgent)
	for name, value := range c.header {
		request.Header.Set(name, value)
	}
	response, err := t.client.Do(request)
	if err != nil {
		return err
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxBodyBytes))
		response.Body.Close()
	}()
	return handle(response)
}

func (t *Transferer) bearer(ticket string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + ticket}
}

// reject turns an unexpected status into a permanent or retryable error.
func reject(response *http.Response) error {
	var detail bytes.Buffer
	_, _ = io.Copy(&detail, io.LimitReader(response.Body, maxDetailBytes))
	message := fmt.Sprintf("kanna answered HTTP %d", response.StatusCode)
	if text := strings.TrimSpace(detail.String()); text != "" {
		message += ": " + text
	}
	switch code := response.StatusCode; {
	case code == http.StatusUnauthorized, code == http.StatusForbidden, code == http.StatusNotFound,
		code == http.StatusGone, code == http.StatusRequestEntityTooLarge, code == http.StatusUnprocessableEntity:
		return permanent("%s", message)
	case code == http.StatusRequestTimeout, code == http.StatusTooManyRequests, code >= 500:
		return errors.New(message)
	default:
		return permanent("%s", message)
	}
}

func decode(response *http.Response, into any) error {
	if err := json.NewDecoder(io.LimitReader(response.Body, maxBodyBytes)).Decode(into); err != nil {
		return permanent("unreadable answer from kanna: %v", err)
	}
	return nil
}

// onlyReader and onlyWriter hide WriterTo and ReaderFrom so io.CopyBuffer
// always uses the fixed buffer it is given.
type onlyReader struct{ io.Reader }

type recordingWriter struct {
	io.Writer
	err error
}

func (w *recordingWriter) Write(p []byte) (int, error) {
	n, err := w.Writer.Write(p)
	if err != nil {
		w.err = err
	}
	return n, err
}

func hashSection(file io.ReaderAt, size int64) (string, error) {
	digest := sha256.New()
	buffer := make([]byte, copyBufferBytes)
	if _, err := io.CopyBuffer(digest, onlyReader{io.NewSectionReader(file, 0, size)}, buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

// cancellableReaderAt stops a hash once its context ends, so a ticket Kanna
// has revoked does not keep a multi-gigabyte hash running.
type cancellableReaderAt struct {
	ctx context.Context
	r   io.ReaderAt
}

func (c cancellableReaderAt) ReadAt(p []byte, off int64) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.r.ReadAt(p, off)
}

// hashKeepingAlive hashes file while sending probe every keep-alive interval.
// A probe that fails transiently is ignored; a permanent failure ends the hash
// and the transfer. The probing goroutine has exited when this returns.
func (t *Transferer) hashKeepingAlive(ctx context.Context, file io.ReaderAt, size int64, probe func(ctx context.Context) error) (string, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var probing sync.WaitGroup
	var probeErr error
	probing.Add(1)
	go func() {
		defer probing.Done()
		ticker := time.NewTicker(t.keepAlive)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				var fatal permanentError
				if err := probe(ctx); errors.As(err, &fatal) {
					probeErr = err
					cancel()
					return
				}
			}
		}
	}()
	digest, err := t.hash(cancellableReaderAt{ctx: ctx, r: file}, size)
	cancel()
	probing.Wait()
	if probeErr != nil {
		return "", probeErr
	}
	return digest, err
}

func smaller(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

// Upload sends the file at path, which must lie inside the read roots, to
// Kanna and returns its size and sha256 once Kanna has verified both.
func (t *Transferer) Upload(ctx context.Context, path, ticket string) (Result, error) {
	real, err := t.containRead(path)
	if err != nil {
		return Result{}, err
	}
	file, err := os.Open(real)
	if err != nil {
		return Result{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return Result{}, err
	}
	if !info.Mode().IsRegular() {
		return Result{}, fmt.Errorf("not a regular file: %s", path)
	}
	size := info.Size()
	digest, err := t.hashKeepingAlive(ctx, file, size, func(ctx context.Context) error {
		_, err := t.fetchResumePoint(ctx, ticket)
		return err
	})
	if err != nil {
		return Result{}, err
	}
	received, err := t.resumePoint(ctx, ticket)
	if err != nil {
		return Result{}, err
	}
	if received > size {
		return Result{}, fmt.Errorf("kanna already holds %d bytes of a %d byte file", received, size)
	}
	if err := t.putChunks(ctx, file, ticket, received, size); err != nil {
		return Result{}, err
	}
	if err := t.complete(ctx, ticket, size, digest); err != nil {
		return Result{}, err
	}
	return Result{Path: real, Bytes: size, SHA256: digest}, nil
}

func (t *Transferer) resumePoint(ctx context.Context, ticket string) (int64, error) {
	var received int64
	err := t.withRetry(ctx, func() error {
		var err error
		received, err = t.fetchResumePoint(ctx, ticket)
		return err
	})
	return received, err
}

// fetchResumePoint asks Kanna once how many bytes of the upload it holds.
func (t *Transferer) fetchResumePoint(ctx context.Context, ticket string) (int64, error) {
	var received int64
	err := t.do(ctx, call{method: http.MethodGet, url: t.base + endpoint, header: t.bearer(ticket)},
		func(response *http.Response) error {
			if response.StatusCode != http.StatusOK {
				return reject(response)
			}
			var answer struct {
				Direction string `json:"direction"`
				Received  int64  `json:"received"`
			}
			if err := decode(response, &answer); err != nil {
				return err
			}
			if answer.Direction != "upload" || answer.Received < 0 {
				return permanent("kanna's answer does not describe an upload")
			}
			received = answer.Received
			return nil
		})
	return received, err
}

func (t *Transferer) putChunks(ctx context.Context, file *os.File, ticket string, offset, size int64) error {
	resyncs := 0
	for offset < size {
		length := smaller(t.chunkBytes, size-offset)
		at := offset
		err := t.withRetry(ctx, func() error { return t.putChunk(ctx, file, ticket, at, length) })
		var resync *resyncError
		if errors.As(err, &resync) {
			resyncs++
			if resync.received < 0 || resync.received > size || resyncs > maxResyncs {
				return fmt.Errorf("kanna and the beacon disagree about how much was sent (kanna holds %d of %d bytes)", resync.received, size)
			}
			offset = resync.received
			continue
		}
		if err != nil {
			return err
		}
		offset += length
	}
	return nil
}

func (t *Transferer) putChunk(ctx context.Context, file *os.File, ticket string, offset, length int64) error {
	header := t.bearer(ticket)
	header["Content-Type"] = "application/octet-stream"
	return t.do(ctx, call{
		method: http.MethodPut,
		url:    t.base + endpoint + "?offset=" + strconv.FormatInt(offset, 10),
		header: header,
		body:   func() io.Reader { return io.NewSectionReader(file, offset, length) },
		length: length,
	}, func(response *http.Response) error {
		var answer struct {
			Received int64 `json:"received"`
		}
		switch response.StatusCode {
		case http.StatusOK:
			if err := decode(response, &answer); err != nil {
				return err
			}
			if answer.Received != offset+length {
				return permanent("kanna acknowledged %d bytes, expected %d", answer.Received, offset+length)
			}
			return nil
		case http.StatusConflict:
			if err := decode(response, &answer); err != nil {
				return err
			}
			return &resyncError{received: answer.Received}
		default:
			return reject(response)
		}
	})
}

func (t *Transferer) complete(ctx context.Context, ticket string, size int64, digest string) error {
	payload, err := json.Marshal(struct {
		Bytes  int64  `json:"bytes"`
		SHA256 string `json:"sha256"`
	}{size, digest})
	if err != nil {
		return err
	}
	header := t.bearer(ticket)
	header["Content-Type"] = "application/json"
	return t.withRetry(ctx, func() error {
		return t.do(ctx, call{
			method: http.MethodPost,
			url:    t.base + endpoint + "/complete",
			header: header,
			body:   func() io.Reader { return bytes.NewReader(payload) },
			length: int64(len(payload)),
		}, func(response *http.Response) error {
			if response.StatusCode != http.StatusOK {
				return reject(response)
			}
			var answer Result
			if err := decode(response, &answer); err != nil {
				return err
			}
			if answer.Bytes != size || answer.SHA256 != digest {
				return permanent("kanna stored %d bytes with sha256 %s, expected %d bytes with %s", answer.Bytes, answer.SHA256, size, digest)
			}
			return nil
		})
	})
}

// Download receives the file Kanna offers into request.Path, which must lie
// inside the write roots. The bytes go to a sibling part file and replace the
// destination only after their size and sha256 match.
func (t *Transferer) Download(ctx context.Context, request DownloadRequest) (Result, error) {
	target, err := fsops.ResolveForWrite(request.Path, t.writeRoots())
	if err != nil {
		return Result{}, err
	}
	if err := refuseExisting(target, request.Overwrite); err != nil {
		return Result{}, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return Result{}, err
	}
	partPath := target + PartSuffix
	part, err := os.OpenFile(partPath, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return Result{}, err
	}
	committed := false
	defer func() {
		if !committed {
			part.Close()
			os.Remove(partPath)
		}
	}()
	for offset := int64(0); offset < request.Size; {
		length := smaller(t.chunkBytes, request.Size-offset)
		at := offset
		if err := t.withRetry(ctx, func() error { return t.getChunk(ctx, part, request.Ticket, at, length) }); err != nil {
			return Result{}, err
		}
		offset += length
	}
	if err := t.verifyPart(ctx, part, request); err != nil {
		return Result{}, err
	}
	if err := part.Close(); err != nil {
		return Result{}, err
	}
	if err := refuseExisting(target, request.Overwrite); err != nil {
		return Result{}, err
	}
	if err := os.Rename(partPath, target); err != nil {
		return Result{}, fmt.Errorf("could not replace %s (is it open in another program?): %w", target, err)
	}
	committed = true
	finalPath := target
	if real, err := fsops.Realpath(target); err == nil {
		finalPath = real
	}
	return Result{Path: finalPath, Bytes: request.Size, SHA256: request.SHA256}, nil
}

func refuseExisting(target string, overwrite bool) error {
	info, err := os.Lstat(target)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("destination is a directory: %s", target)
	}
	if !overwrite {
		return fmt.Errorf("destination already exists and overwrite is not set: %s", target)
	}
	return nil
}

func (t *Transferer) verifyPart(ctx context.Context, part *os.File, request DownloadRequest) error {
	info, err := part.Stat()
	if err != nil {
		return err
	}
	if info.Size() != request.Size {
		return fmt.Errorf("received %d bytes, expected %d", info.Size(), request.Size)
	}
	digest, err := t.hashKeepingAlive(ctx, part, request.Size, func(ctx context.Context) error {
		return t.touchDownload(ctx, request.Ticket)
	})
	if err != nil {
		return err
	}
	if digest != request.SHA256 {
		return fmt.Errorf("sha256 mismatch: received %s, expected %s", digest, request.SHA256)
	}
	return nil
}

// touchDownload asks Kanna once for the first byte of the download, which
// keeps the ticket alive; the byte itself is discarded.
func (t *Transferer) touchDownload(ctx context.Context, ticket string) error {
	header := t.bearer(ticket)
	header["Range"] = "bytes=0-0"
	return t.do(ctx, call{method: http.MethodGet, url: t.base + endpoint, header: header},
		func(response *http.Response) error {
			if response.StatusCode != http.StatusPartialContent {
				return reject(response)
			}
			return nil
		})
}

func (t *Transferer) getChunk(ctx context.Context, part *os.File, ticket string, offset, length int64) error {
	if err := part.Truncate(offset); err != nil {
		return permanentError{err: err}
	}
	if _, err := part.Seek(offset, io.SeekStart); err != nil {
		return permanentError{err: err}
	}
	header := t.bearer(ticket)
	header["Range"] = fmt.Sprintf("bytes=%d-%d", offset, offset+length-1)
	return t.do(ctx, call{method: http.MethodGet, url: t.base + endpoint, header: header},
		func(response *http.Response) error {
			if response.StatusCode != http.StatusPartialContent {
				if response.StatusCode == http.StatusOK {
					return permanent("kanna ignored the Range header")
				}
				return reject(response)
			}
			writer := &recordingWriter{Writer: part}
			buffer := make([]byte, copyBufferBytes)
			copied, err := io.CopyBuffer(writer, onlyReader{io.LimitReader(response.Body, length+1)}, buffer)
			if writer.err != nil {
				return permanent("writing %s: %v", part.Name(), writer.err)
			}
			if err != nil {
				return err
			}
			if copied != length {
				return fmt.Errorf("chunk at %d: received %d bytes, expected %d", offset, copied, length)
			}
			return nil
		})
}
