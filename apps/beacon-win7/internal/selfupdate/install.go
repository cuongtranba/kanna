package selfupdate

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transport"
)

// File suffixes next to the executable. The new build is downloaded to
// <exe>.kanna-update; the running one is moved to <exe>.old, or to
// <exe>.old-<n> when an earlier .old is still locked by a running process
// (on Windows, the supervisor that started this beacon keeps its image open).
const (
	StagingSuffix = ".kanna-update"
	OldSuffix     = ".old"
)

const (
	// DefaultIdleTimeout ends a download that receives nothing for this long.
	// There is no whole-request deadline: a slow link may need minutes.
	DefaultIdleTimeout = 60 * time.Second
	smokeTimeout       = 30 * time.Second
	maxChecksumBytes   = 64 << 10
	maxAssetBytes      = 256 << 20
	maxVersionBytes    = 4 << 10
)

// rename is os.Rename; the swap tests replace it to make a step fail.
var rename = os.Rename

// Config describes one InstallRelease call.
type Config struct {
	// ExecPath is the running executable, which the new build replaces.
	ExecPath string
	// Asset is the release file name, from AssetName.
	Asset string
	// Version is the release to install, without a leading v.
	Version string
	// ReleaseBase defaults to DefaultReleaseBase; files are fetched from
	// <ReleaseBase>/v<Version>/<name>.
	ReleaseBase string
	// Client defaults to NewHTTPClient().
	Client *http.Client
	// UserAgent defaults to "kanna-beacon".
	UserAgent string
	// IdleTimeout defaults to DefaultIdleTimeout.
	IdleTimeout time.Duration
	// OnProgress hears protocol.UpdateDownloading, then
	// protocol.UpdateInstalling.
	OnProgress func(step string)
	// BeforeSwap runs after the new build is verified and before it replaces
	// the running one; an error abandons the install. The runner waits there
	// for in-flight requests to finish.
	BeforeSwap func() error
	// SmokeTest defaults to running "<path> version" and requiring it to
	// print exactly the version.
	SmokeTest func(ctx context.Context, path, version string) error
}

// NewHTTPClient follows a release download across hosts (github.com, then
// release-assets.githubusercontent.com), verifying each hop's certificate
// under its own name with the same system-then-embedded roots as the Kanna
// connection. It has no whole-request timeout; InstallRelease bounds silence
// instead.
func NewHTTPClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			TLSClientConfig:       transport.PerHostTLSConfig(),
			TLSHandshakeTimeout:   30 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
			IdleConnTimeout:       90 * time.Second,
		},
	}
}

// InstallRelease downloads Version's Asset, checks it against the release's
// SHA256SUMS-win7, runs it once to confirm it starts and reports Version,
// and only then swaps it in for ExecPath. On any failure the running
// executable is left as it was and the download is deleted.
func InstallRelease(ctx context.Context, cfg Config) error {
	if !ValidVersion(cfg.Version) {
		return fmt.Errorf("%q is not a release version", cfg.Version)
	}
	if cfg.ExecPath == "" {
		return errors.New("cannot find this beacon's own executable")
	}
	if cfg.ReleaseBase == "" {
		cfg.ReleaseBase = DefaultReleaseBase
	}
	if cfg.Client == nil {
		cfg.Client = NewHTTPClient()
	}
	if cfg.UserAgent == "" {
		cfg.UserAgent = "kanna-beacon"
	}
	if cfg.IdleTimeout <= 0 {
		cfg.IdleTimeout = DefaultIdleTimeout
	}
	if cfg.SmokeTest == nil {
		cfg.SmokeTest = RunVersion
	}
	progress := func(step string) {
		if cfg.OnProgress != nil {
			cfg.OnProgress(step)
		}
	}
	release := strings.TrimRight(cfg.ReleaseBase, "/") + "/v" + cfg.Version + "/"
	sums, err := fetchChecksums(ctx, cfg, release)
	if err != nil {
		return err
	}
	want, ok := ParseChecksums(sums)[cfg.Asset]
	if !ok {
		return fmt.Errorf("%s of release v%s lists no %s", ChecksumFile, cfg.Version, cfg.Asset)
	}
	progress(protocol.UpdateDownloading)
	staging := cfg.ExecPath + StagingSuffix
	if err := download(ctx, cfg, release, staging, want); err != nil {
		_ = os.Remove(staging)
		return err
	}
	progress(protocol.UpdateInstalling)
	if err := cfg.SmokeTest(ctx, staging, cfg.Version); err != nil {
		_ = os.Remove(staging)
		return err
	}
	if cfg.BeforeSwap != nil {
		if err := cfg.BeforeSwap(); err != nil {
			_ = os.Remove(staging)
			return err
		}
	}
	if err := swap(cfg.ExecPath, staging); err != nil {
		_ = os.Remove(staging)
		return err
	}
	return nil
}

// idleWatch cancels a request that receives nothing for its timeout.
type idleWatch struct {
	timer   *time.Timer
	timeout time.Duration
	fired   atomic.Bool
}

func watchIdle(ctx context.Context, timeout time.Duration) (context.Context, *idleWatch, context.CancelFunc) {
	ctx, cancel := context.WithCancel(ctx)
	watch := &idleWatch{timeout: timeout}
	watch.timer = time.AfterFunc(timeout, func() {
		watch.fired.Store(true)
		cancel()
	})
	return ctx, watch, func() {
		watch.timer.Stop()
		cancel()
	}
}

func (w *idleWatch) Read(body io.Reader, buffer []byte) (int, error) {
	n, err := body.Read(buffer)
	if n > 0 {
		w.timer.Reset(w.timeout)
	}
	return n, err
}

type watchedReader struct {
	body  io.Reader
	watch *idleWatch
}

func (r watchedReader) Read(buffer []byte) (int, error) { return r.watch.Read(r.body, buffer) }

func (w *idleWatch) explain(err error, name string) error {
	if w.fired.Load() {
		return fmt.Errorf("downloading %s stalled: nothing arrived for %s", name, w.timeout)
	}
	return err
}

func open(ctx context.Context, cfg Config, release, name string) (io.ReadCloser, *idleWatch, context.CancelFunc, error) {
	ctx, watch, stop := watchIdle(ctx, cfg.IdleTimeout)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, release+name, nil)
	if err != nil {
		stop()
		return nil, nil, nil, err
	}
	request.Header.Set("User-Agent", cfg.UserAgent)
	response, err := cfg.Client.Do(request)
	if err != nil {
		stop()
		return nil, nil, nil, watch.explain(fmt.Errorf("downloading %s: %w", name, err), name)
	}
	if response.StatusCode == http.StatusNotFound {
		response.Body.Close()
		stop()
		return nil, nil, nil, fmt.Errorf("release v%s has no %s yet", cfg.Version, name)
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		stop()
		return nil, nil, nil, fmt.Errorf("downloading %s from release v%s: HTTP %d", name, cfg.Version, response.StatusCode)
	}
	return response.Body, watch, stop, nil
}

func fetchChecksums(ctx context.Context, cfg Config, release string) (string, error) {
	body, watch, stop, err := open(ctx, cfg, release, ChecksumFile)
	if err != nil {
		return "", err
	}
	defer stop()
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(watchedReader{body: body, watch: watch}, maxChecksumBytes+1))
	if err != nil {
		return "", watch.explain(fmt.Errorf("downloading %s: %w", ChecksumFile, err), ChecksumFile)
	}
	if len(data) > maxChecksumBytes {
		return "", fmt.Errorf("%s of release v%s is larger than %d bytes", ChecksumFile, cfg.Version, maxChecksumBytes)
	}
	return string(data), nil
}

// download streams the asset to staging, hashing as it goes, and fails
// unless the digest matches want.
func download(ctx context.Context, cfg Config, release, staging, want string) error {
	body, watch, stop, err := open(ctx, cfg, release, cfg.Asset)
	if err != nil {
		return err
	}
	defer stop()
	defer body.Close()
	file, err := os.OpenFile(staging, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return fmt.Errorf("cannot write next to this beacon: %w", err)
	}
	digest := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, digest), io.LimitReader(watchedReader{body: body, watch: watch}, maxAssetBytes+1))
	closeErr := file.Close()
	if copyErr != nil {
		return watch.explain(fmt.Errorf("downloading %s: %w", cfg.Asset, copyErr), cfg.Asset)
	}
	if closeErr != nil {
		return fmt.Errorf("writing %s: %w", staging, closeErr)
	}
	if written > maxAssetBytes {
		return fmt.Errorf("%s of release v%s is larger than %d bytes", cfg.Asset, cfg.Version, maxAssetBytes)
	}
	if got := hex.EncodeToString(digest.Sum(nil)); got != want {
		return fmt.Errorf("%s of release v%s does not match its %s entry", cfg.Asset, cfg.Version, ChecksumFile)
	}
	return nil
}

type cappedBuffer struct {
	bytes.Buffer
}

func (c *cappedBuffer) Write(data []byte) (int, error) {
	if room := maxVersionBytes - c.Len(); room > 0 {
		if len(data) > room {
			c.Buffer.Write(data[:room])
		} else {
			c.Buffer.Write(data)
		}
	}
	return len(data), nil
}

// RunVersion is the default smoke test: "<path> version" must exit 0 within
// 30 s and print exactly version. Both Windows 7 programs answer it, the tray
// included: it is built for the GUI subsystem and has no console, but it
// writes to the stdout pipe this process hands it.
func RunVersion(ctx context.Context, path, version string) error {
	ctx, cancel := context.WithTimeout(ctx, smokeTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, path, "version")
	hideWindow(command)
	var stdout cappedBuffer
	command.Stdout = &stdout
	if err := command.Run(); err != nil {
		return fmt.Errorf("the downloaded beacon did not start: %w", err)
	}
	if got := strings.TrimSpace(stdout.String()); got != version {
		return fmt.Errorf("the downloaded beacon reports version %q, not %s", got, version)
	}
	return nil
}

// swap moves the running executable aside and the new one into its place,
// restoring the original when the second step fails. Windows lets a running
// executable be renamed but not deleted, so the old one stays as <exe>.old
// until CleanupLeftovers removes it on a later start.
func swap(exe, staging string) error {
	old := exe + OldSuffix
	if err := os.Remove(old); err != nil && !os.IsNotExist(err) {
		old = fmt.Sprintf("%s%s-%d", exe, OldSuffix, time.Now().UnixNano())
	}
	if err := rename(exe, old); err != nil {
		return fmt.Errorf("cannot move the running beacon aside: %w", err)
	}
	if err := rename(staging, exe); err != nil {
		if restoreErr := rename(old, exe); restoreErr != nil {
			return fmt.Errorf("cannot put the new beacon in place (%v), nor restore the old one from %s: %v", err, old, restoreErr)
		}
		return fmt.Errorf("cannot put the new beacon in place: %w", err)
	}
	return nil
}

// CleanupLeftovers removes what an earlier update left next to exe: the old
// executable and an abandoned download. It returns the last removal that
// failed, typically an old executable some process still has open.
func CleanupLeftovers(exe string) error {
	dir, base := filepath.Dir(exe), filepath.Base(exe)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var failed error
	for _, entry := range entries {
		name := entry.Name()
		if name != base+StagingSuffix && name != base+OldSuffix && !strings.HasPrefix(name, base+OldSuffix+"-") {
			continue
		}
		if err := os.Remove(filepath.Join(dir, name)); err != nil && !os.IsNotExist(err) {
			failed = err
		}
	}
	return failed
}

// Options configure an Updater.
type Options struct {
	Kind           Kind
	ExecPath       string
	CurrentVersion string
	ReleaseBase    string
	Client         *http.Client
}

// Updater installs releases over the running executable. It satisfies the
// runner's Updater port.
type Updater struct {
	options Options
}

// NewUpdater returns an Updater for this process.
func NewUpdater(options Options) *Updater {
	return &Updater{options: options}
}

// Install installs version. An unstamped development build refuses, since
// the release it would install is not the code it runs.
func (u *Updater) Install(ctx context.Context, version string, progress func(step string), beforeSwap func() error) error {
	if strings.HasSuffix(u.options.CurrentVersion, "-dev") {
		return errors.New("this is an unstamped development build, which does not update itself")
	}
	asset, err := AssetName(u.options.Kind, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}
	return InstallRelease(ctx, Config{
		ExecPath:    u.options.ExecPath,
		Asset:       asset,
		Version:     version,
		ReleaseBase: u.options.ReleaseBase,
		Client:      u.options.Client,
		UserAgent:   "kanna-beacon/" + u.options.CurrentVersion,
		OnProgress:  progress,
		BeforeSwap:  beforeSwap,
	})
}
