package selfupdate_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/selfupdate"
)

const helperVersionEnv = "KANNA_SELFUPDATE_HELPER_VERSION"

// TestMain lets the test binary double as the downloaded beacon: run as
// "<binary> version" with the helper variable set, it prints that variable.
func TestMain(m *testing.M) {
	reported := os.Getenv(helperVersionEnv)
	if reported == "" {
		os.Exit(m.Run())
	}
	if len(os.Args) > 1 && os.Args[1] == "version" {
		fmt.Println(reported)
		os.Exit(0)
	}
	os.Exit(3)
}

func TestDecide(t *testing.T) {
	now := time.Unix(10_000, 0)
	recent := &selfupdate.Failure{Version: "1.71.0", At: now.Add(-10 * time.Minute)}
	stale := &selfupdate.Failure{Version: "1.71.0", At: now.Add(-31 * time.Minute)}
	other := &selfupdate.Failure{Version: "1.70.5", At: now.Add(-time.Minute)}
	install := selfupdate.Decision{Kind: selfupdate.Install, Version: "1.71.0"}
	none := selfupdate.Decision{Kind: selfupdate.None}
	cases := []struct {
		name    string
		beacon  string
		server  string
		trigger selfupdate.Trigger
		auto    bool
		failure *selfupdate.Failure
		want    selfupdate.Decision
	}{
		{"auto installs a newer server version", "1.70.0", "1.71.0", selfupdate.Auto, true, nil, install},
		{"manual installs a newer server version", "1.70.0", "1.71.0", selfupdate.Manual, true, nil, install},
		{"auto never downgrades", "1.72.0", "1.71.0", selfupdate.Auto, true, nil, none},
		{"manual never downgrades and reports current", "1.72.0", "1.71.0", selfupdate.Manual, true, nil, selfupdate.Decision{Kind: selfupdate.Current, Version: "1.72.0"}},
		{"auto on the same version does nothing", "1.71.0", "1.71.0", selfupdate.Auto, true, nil, none},
		{"manual on the same version reports current", "1.71.0", "1.71.0", selfupdate.Manual, true, nil, selfupdate.Decision{Kind: selfupdate.Current, Version: "1.71.0"}},
		{"auto disabled skips an automatic update", "1.70.0", "1.71.0", selfupdate.Auto, false, nil, none},
		{"auto disabled still allows a manual update", "1.70.0", "1.71.0", selfupdate.Manual, false, nil, install},
		{"auto backs off after a recent failure of that version", "1.70.0", "1.71.0", selfupdate.Auto, true, recent, none},
		{"auto retries once the backoff has passed", "1.70.0", "1.71.0", selfupdate.Auto, true, stale, install},
		{"a failure of another version does not back off", "1.70.0", "1.71.0", selfupdate.Auto, true, other, install},
		{"manual ignores the backoff", "1.70.0", "1.71.0", selfupdate.Manual, true, recent, install},
		{"no server version does nothing", "1.70.0", "", selfupdate.Manual, true, nil, none},
		{"a server version that is not a release does nothing", "1.70.0", "1.71.0/../../evil", selfupdate.Manual, true, nil, none},
		{"a v-prefixed server version is not a release version", "1.70.0", "v1.71.0", selfupdate.Auto, true, nil, none},
		{"a development beacon is behind any release", "0.0.0-dev", "1.71.0", selfupdate.Auto, true, nil, install},
		{"a prerelease server version installs", "1.70.0", "1.71.0-rc.1", selfupdate.Auto, true, nil, selfupdate.Decision{Kind: selfupdate.Install, Version: "1.71.0-rc.1"}},
	}
	for _, tc := range cases {
		if got := selfupdate.Decide(tc.beacon, tc.server, tc.trigger, tc.auto, tc.failure, now); got != tc.want {
			t.Errorf("%s: Decide = %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

func TestIsBehindMatchesTheServersRule(t *testing.T) {
	cases := []struct {
		beacon, server string
		want           bool
	}{
		{"1.70.0", "1.71.0", true},
		{"1.71.0", "1.71.0", false},
		{"1.71.0", "1.70.9", false},
		{"1.9.0", "1.10.0", true},
		{"v1.70.0", "1.71.0", true},
		{"1.71.0-rc.1", "1.71.0", false},
		{"1.71", "1.71.0", false},
		{"1.71", "1.71.1", true},
		{"0.0.0-dev", "1.0.0", true},
		{"abc", "abd", true},
		{"1.7rc.0", "1.7.1", true},
	}
	for _, tc := range cases {
		if got := selfupdate.IsBehind(tc.beacon, tc.server); got != tc.want {
			t.Errorf("IsBehind(%q, %q) = %v, want %v", tc.beacon, tc.server, got, tc.want)
		}
	}
}

func TestAssetName(t *testing.T) {
	cases := []struct {
		kind         selfupdate.Kind
		goos, goarch string
		want         string
		wantErr      bool
	}{
		{selfupdate.CLI, "windows", "amd64", "kanna-beacon-win7-x64.exe", false},
		{selfupdate.CLI, "windows", "386", "kanna-beacon-win7-x86.exe", false},
		{selfupdate.Tray, "windows", "amd64", "kanna-beacon-tray-win7-x64.exe", false},
		{selfupdate.Tray, "windows", "386", "kanna-beacon-tray-win7-x86.exe", false},
		{selfupdate.CLI, "windows", "arm64", "", true},
		{selfupdate.CLI, "darwin", "amd64", "", true},
	}
	for _, tc := range cases {
		got, err := selfupdate.AssetName(tc.kind, tc.goos, tc.goarch)
		if got != tc.want || (err != nil) != tc.wantErr {
			t.Errorf("AssetName(%v, %s, %s) = %q, %v", tc.kind, tc.goos, tc.goarch, got, err)
		}
	}
}

func TestParseChecksumsReadsSha256sumOutput(t *testing.T) {
	a := strings.Repeat("ab", 32)
	b := strings.Repeat("CD", 32)
	text := a + "  kanna-beacon-win7-x64.exe\n" +
		b + " *kanna-beacon-tray-win7-x86.exe\r\n" +
		"not a checksum line\n" +
		strings.Repeat("zz", 32) + "  bad-hex.exe\n" +
		"\n"
	got := selfupdate.ParseChecksums(text)
	want := map[string]string{
		"kanna-beacon-win7-x64.exe":      a,
		"kanna-beacon-tray-win7-x86.exe": strings.ToLower(b),
	}
	if len(got) != len(want) {
		t.Fatalf("parsed %v", got)
	}
	for name, digest := range want {
		if got[name] != digest {
			t.Errorf("%s = %q, want %q", name, got[name], digest)
		}
	}
}

func TestFromEnvironment(t *testing.T) {
	cases := []struct {
		env  map[string]string
		want selfupdate.Settings
	}{
		{map[string]string{}, selfupdate.Settings{AutoUpdate: true, ReleaseBase: selfupdate.DefaultReleaseBase}},
		{map[string]string{selfupdate.AutoUpdateEnv: "disabled"}, selfupdate.Settings{AutoUpdate: false, ReleaseBase: selfupdate.DefaultReleaseBase}},
		{map[string]string{selfupdate.AutoUpdateEnv: " Disabled "}, selfupdate.Settings{AutoUpdate: false, ReleaseBase: selfupdate.DefaultReleaseBase}},
		{map[string]string{selfupdate.AutoUpdateEnv: "enabled", selfupdate.ReleaseBaseEnv: "http://localhost:9000/r"}, selfupdate.Settings{AutoUpdate: true, ReleaseBase: "http://localhost:9000/r"}},
	}
	for _, tc := range cases {
		if got := selfupdate.FromEnvironment(func(key string) string { return tc.env[key] }); got != tc.want {
			t.Errorf("FromEnvironment(%v) = %+v, want %+v", tc.env, got, tc.want)
		}
	}
}

const (
	version = "1.71.0"
	asset   = "kanna-beacon-win7-x64.exe"
	oldExe  = "the build that is running now"
)

func digestOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// releaseServer serves files at /v<version>/<name>, the GitHub release
// download layout.
func releaseServer(t *testing.T, files map[string][]byte) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, ok := files[strings.TrimPrefix(r.URL.Path, "/v"+version+"/")]
		if !ok || !strings.HasPrefix(r.URL.Path, "/v"+version+"/") {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(data)
	}))
	t.Cleanup(server.Close)
	return server
}

func testBinary(t *testing.T) []byte {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

type install struct {
	dir   string
	exe   string
	mu    sync.Mutex
	steps []string
}

func newInstall(t *testing.T) *install {
	t.Helper()
	dir := t.TempDir()
	exe := filepath.Join(dir, "kanna-beacon.exe")
	if err := os.WriteFile(exe, []byte(oldExe), 0o755); err != nil {
		t.Fatal(err)
	}
	return &install{dir: dir, exe: exe}
}

func (i *install) config(base string) selfupdate.Config {
	return selfupdate.Config{
		ExecPath:    i.exe,
		Asset:       asset,
		Version:     version,
		ReleaseBase: base,
		Client:      &http.Client{},
		OnProgress: func(step string) {
			i.mu.Lock()
			defer i.mu.Unlock()
			i.steps = append(i.steps, step)
		},
	}
}

func (i *install) files(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(i.dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	return names
}

func (i *install) assertUntouched(t *testing.T) {
	t.Helper()
	data, err := os.ReadFile(i.exe)
	if err != nil || string(data) != oldExe {
		t.Fatalf("the running executable changed: %q, %v", data, err)
	}
	if names := i.files(t); len(names) != 1 || names[0] != "kanna-beacon.exe" {
		t.Fatalf("left behind %v", names)
	}
}

func TestInstallSwapsInAVerifiedBuildThatReportsTheVersion(t *testing.T) {
	t.Setenv(helperVersionEnv, version)
	binary := testBinary(t)
	server := releaseServer(t, map[string][]byte{
		selfupdate.ChecksumFile: []byte(digestOf(binary) + "  " + asset + "\n" + strings.Repeat("0", 64) + "  other.exe\n"),
		asset:                   binary,
	})
	i := newInstall(t)
	cfg := i.config(server.URL + "/")
	swappedEarly := false
	cfg.BeforeSwap = func() error {
		data, _ := os.ReadFile(i.exe)
		swappedEarly = string(data) != oldExe
		return nil
	}
	if err := selfupdate.InstallRelease(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	if swappedEarly {
		t.Fatal("the executable was replaced before BeforeSwap returned")
	}
	installed, _ := os.ReadFile(i.exe)
	if digestOf(installed) != digestOf(binary) {
		t.Fatal("the executable is not the downloaded build")
	}
	old, _ := os.ReadFile(i.exe + selfupdate.OldSuffix)
	if string(old) != oldExe {
		t.Fatalf("the previous build was not kept as .old: %q", old)
	}
	if got := strings.Join(i.steps, ","); got != protocol.UpdateDownloading+","+protocol.UpdateInstalling {
		t.Fatalf("progress %s", got)
	}
	if err := selfupdate.CleanupLeftovers(i.exe); err != nil {
		t.Fatal(err)
	}
	if names := i.files(t); len(names) != 1 || names[0] != "kanna-beacon.exe" {
		t.Fatalf("cleanup left %v", names)
	}
}

func TestAChecksumMismatchLeavesTheRunningBuildByteIdentical(t *testing.T) {
	t.Setenv(helperVersionEnv, version)
	binary := testBinary(t)
	server := releaseServer(t, map[string][]byte{
		selfupdate.ChecksumFile: []byte(digestOf([]byte("something else")) + "  " + asset + "\n"),
		asset:                   binary,
	})
	i := newInstall(t)
	err := selfupdate.InstallRelease(context.Background(), i.config(server.URL))
	if err == nil || !strings.Contains(err.Error(), "does not match its SHA256SUMS-win7 entry") {
		t.Fatalf("err = %v", err)
	}
	i.assertUntouched(t)
}

func TestAMissingReleaseFileSaysWhichOneIsMissing(t *testing.T) {
	cases := []struct {
		name  string
		files map[string][]byte
		want  string
	}{
		{"no asset", map[string][]byte{selfupdate.ChecksumFile: []byte(digestOf(nil) + "  " + asset + "\n")}, "release v1.71.0 has no kanna-beacon-win7-x64.exe yet"},
		{"no checksums", map[string][]byte{asset: []byte("x")}, "release v1.71.0 has no SHA256SUMS-win7 yet"},
		{"asset not listed", map[string][]byte{selfupdate.ChecksumFile: []byte(digestOf(nil) + "  other.exe\n"), asset: []byte("x")}, "SHA256SUMS-win7 of release v1.71.0 lists no kanna-beacon-win7-x64.exe"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := releaseServer(t, tc.files)
			i := newInstall(t)
			err := selfupdate.InstallRelease(context.Background(), i.config(server.URL))
			if err == nil || err.Error() != tc.want {
				t.Fatalf("err = %v, want %q", err, tc.want)
			}
			i.assertUntouched(t)
		})
	}
}

func TestABuildReportingAnotherVersionIsNotInstalled(t *testing.T) {
	t.Setenv(helperVersionEnv, "9.9.9")
	binary := testBinary(t)
	server := releaseServer(t, map[string][]byte{
		selfupdate.ChecksumFile: []byte(digestOf(binary) + "  " + asset + "\n"),
		asset:                   binary,
	})
	i := newInstall(t)
	err := selfupdate.InstallRelease(context.Background(), i.config(server.URL))
	if err == nil || !strings.Contains(err.Error(), `reports version "9.9.9", not 1.71.0`) {
		t.Fatalf("err = %v", err)
	}
	i.assertUntouched(t)
}

func TestABuildThatDoesNotRunIsNotInstalled(t *testing.T) {
	notAProgram := []byte("this is not an executable")
	server := releaseServer(t, map[string][]byte{
		selfupdate.ChecksumFile: []byte(digestOf(notAProgram) + "  " + asset + "\n"),
		asset:                   notAProgram,
	})
	i := newInstall(t)
	err := selfupdate.InstallRelease(context.Background(), i.config(server.URL))
	if err == nil || !strings.Contains(err.Error(), "the downloaded beacon did not start") {
		t.Fatalf("err = %v", err)
	}
	i.assertUntouched(t)
}

func TestARefusalBeforeTheSwapAbandonsTheInstall(t *testing.T) {
	payload := []byte("new build")
	server := releaseServer(t, map[string][]byte{
		selfupdate.ChecksumFile: []byte(digestOf(payload) + "  " + asset + "\n"),
		asset:                   payload,
	})
	i := newInstall(t)
	cfg := i.config(server.URL)
	cfg.SmokeTest = func(context.Context, string, string) error { return nil }
	cfg.BeforeSwap = func() error { return errors.New("connection closed") }
	if err := selfupdate.InstallRelease(context.Background(), cfg); err == nil || err.Error() != "connection closed" {
		t.Fatalf("err = %v", err)
	}
	i.assertUntouched(t)
}

func TestARedirectToAnotherHostIsFollowed(t *testing.T) {
	payload := []byte("new build")
	assets := releaseServer(t, map[string][]byte{
		selfupdate.ChecksumFile: []byte(digestOf(payload) + "  " + asset + "\n"),
		asset:                   payload,
	})
	var mu sync.Mutex
	var redirected []string
	releases := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		redirected = append(redirected, r.URL.Path)
		mu.Unlock()
		http.Redirect(w, r, assets.URL+r.URL.Path, http.StatusFound)
	}))
	t.Cleanup(releases.Close)
	i := newInstall(t)
	cfg := i.config(releases.URL)
	cfg.SmokeTest = func(context.Context, string, string) error { return nil }
	if err := selfupdate.InstallRelease(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(i.exe); string(data) != "new build" {
		t.Fatalf("installed %q", data)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(redirected) != 2 || redirected[0] != "/v1.71.0/SHA256SUMS-win7" || redirected[1] != "/v1.71.0/"+asset {
		t.Fatalf("release host saw %v", redirected)
	}
}

func TestADownloadThatGoesSilentIsAbandoned(t *testing.T) {
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	payload := []byte("new build")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, selfupdate.ChecksumFile) {
			_, _ = w.Write([]byte(digestOf(payload) + "  " + asset + "\n"))
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(len(payload)))
		_, _ = w.Write(payload[:3])
		w.(http.Flusher).Flush()
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(server.Close)
	i := newInstall(t)
	cfg := i.config(server.URL)
	cfg.IdleTimeout = 200 * time.Millisecond
	err := selfupdate.InstallRelease(context.Background(), cfg)
	if err == nil || !strings.Contains(err.Error(), "stalled") {
		t.Fatalf("err = %v", err)
	}
	i.assertUntouched(t)
}

func TestCleanupLeftoversRemovesOnlyUpdateFiles(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "kanna-beacon.exe")
	for _, name := range []string{"kanna-beacon.exe", "kanna-beacon.exe.old", "kanna-beacon.exe.old-123", "kanna-beacon.exe.kanna-update", "kanna-beacon.exe.older", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := selfupdate.CleanupLeftovers(exe); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(dir)
	var names []string
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	if strings.Join(names, ",") != "kanna-beacon.exe,kanna-beacon.exe.older,notes.txt" {
		t.Fatalf("left %v", names)
	}
}

func TestADevelopmentBuildDoesNotUpdateItself(t *testing.T) {
	updater := selfupdate.NewUpdater(selfupdate.Options{CurrentVersion: "0.0.0-dev", ExecPath: "/nowhere"})
	err := updater.Install(context.Background(), version, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "development build") {
		t.Fatalf("err = %v", err)
	}
}
