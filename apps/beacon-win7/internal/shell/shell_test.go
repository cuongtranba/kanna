package shell_test

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/shell"
)

const helperEnv = "KANNA_BEACON_SHELL_HELPER"

// TestMain lets the test binary double as the child process the shell runs,
// so every case spawns a real process on Linux, macOS and Windows alike.
func TestMain(m *testing.M) {
	switch os.Getenv(helperEnv) {
	case "":
		os.Exit(m.Run())
	case "hello":
		fmt.Print("hello\n")
		os.Exit(0)
	case "exit3":
		os.Exit(3)
	case "linger":
		time.Sleep(30 * time.Second)
		os.Exit(0)
	case "flood":
		fmt.Print(strings.Repeat("abcdefghij", 500))
		os.Exit(0)
	case "split-utf8":
		for _, b := range []byte("é😀") {
			os.Stdout.Write([]byte{b})
		}
		os.Exit(0)
	case "both":
		fmt.Fprint(os.Stdout, "out")
		fmt.Fprint(os.Stderr, "err")
		os.Exit(0)
	case "cwd":
		dir, _ := os.Getwd()
		fmt.Print(dir)
		os.Exit(0)
	}
	os.Exit(2)
}

type collector struct {
	mu       sync.Mutex
	out, err strings.Builder
}

func (c *collector) Stdout(chunk string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.out.WriteString(chunk)
}

func (c *collector) Stderr(chunk string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.err.WriteString(chunk)
}

var limits = shell.Limits{Timeout: 20 * time.Second, TimeoutMs: 20000, OutputByteCap: 100000}

func helper(t *testing.T, mode string) {
	t.Helper()
	t.Setenv(helperEnv, mode)
}

func self(t *testing.T) string {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return exe
}

func TestExecReturnsTheProgramOutputAndExitCodeZero(t *testing.T) {
	helper(t, "hello")
	var c collector
	if code := shell.Exec(self(t), nil, "", &c, limits); code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	if c.out.String() != "hello\n" {
		t.Fatalf("stdout = %q", c.out.String())
	}
}

func TestExecReportsANonZeroExitCode(t *testing.T) {
	helper(t, "exit3")
	var c collector
	if code := shell.Exec(self(t), nil, "", &c, limits); code != 3 {
		t.Fatalf("exit code = %d, want 3", code)
	}
}

func TestExecRunsInTheRequestedDirectory(t *testing.T) {
	helper(t, "cwd")
	dir := t.TempDir()
	var c collector
	if code := shell.Exec(self(t), nil, dir, &c, limits); code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	got, err := os.Stat(c.out.String())
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(got, want) {
		t.Fatalf("child ran in %q, want %q", c.out.String(), dir)
	}
}

func TestKillsACommandThatOutlivesTheTimeout(t *testing.T) {
	helper(t, "linger")
	var c collector
	started := time.Now()
	code := shell.Exec(self(t), nil, "", &c, shell.Limits{Timeout: 200 * time.Millisecond, TimeoutMs: 200, OutputByteCap: 1000})
	if code != shell.TimeoutExitCode {
		t.Fatalf("exit code = %d, want %d", code, shell.TimeoutExitCode)
	}
	if !strings.Contains(c.err.String(), "\n[timed out after 200 ms]\n") {
		t.Fatalf("stderr = %q", c.err.String())
	}
	if elapsed := time.Since(started); elapsed > 15*time.Second {
		t.Fatalf("timeout took %v", elapsed)
	}
}

func TestTruncatesOutputBeyondTheByteCapWithoutKillingTheProcess(t *testing.T) {
	helper(t, "flood")
	var c collector
	code := shell.Exec(self(t), nil, "", &c, shell.Limits{Timeout: 20 * time.Second, TimeoutMs: 20000, OutputByteCap: 100})
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	if c.out.Len() != 100 {
		t.Fatalf("forwarded %d bytes, want 100", c.out.Len())
	}
	if c.err.String() != "\n[output truncated at 100 bytes]\n" {
		t.Fatalf("stderr = %q", c.err.String())
	}
}

func TestTheByteCapIsSharedBetweenStdoutAndStderr(t *testing.T) {
	helper(t, "both")
	var c collector
	shell.Exec(self(t), nil, "", &c, shell.Limits{Timeout: 20 * time.Second, TimeoutMs: 20000, OutputByteCap: 4})
	total := c.out.Len() + len(strings.Replace(c.err.String(), "\n[output truncated at 4 bytes]\n", "", 1))
	if total != 4 {
		t.Fatalf("forwarded %d bytes across both streams, want 4 (out=%q err=%q)", total, c.out.String(), c.err.String())
	}
}

func TestDecodesACharacterSplitAcrossWrites(t *testing.T) {
	helper(t, "split-utf8")
	var c collector
	if code := shell.Exec(self(t), nil, "", &c, limits); code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	if c.out.String() != "é😀" {
		t.Fatalf("stdout = %q", c.out.String())
	}
}

func TestASpawnFailureExitsWith127(t *testing.T) {
	var c collector
	code := shell.Exec("kanna-beacon-no-such-program-xyz", []string{"a"}, "", &c, limits)
	if code != shell.SpawnFailureExitCode {
		t.Fatalf("exit code = %d, want 127", code)
	}
	if !strings.HasSuffix(c.err.String(), "\n") || len(c.err.String()) < 2 {
		t.Fatalf("stderr = %q", c.err.String())
	}
}

func TestScriptRunsThroughThePlatformShell(t *testing.T) {
	var c collector
	body, want := "echo $((1+2))", "3\n"
	if runtime.GOOS == "windows" {
		body, want = "Write-Output (1+2)", "3\r\n"
	}
	if code := shell.Script(body, &c, limits); code != 0 {
		t.Fatalf("exit code = %d (stderr %q)", code, c.err.String())
	}
	if c.out.String() != want {
		t.Fatalf("stdout = %q, want %q", c.out.String(), want)
	}
}

func TestASignalledCommandExitsWithOne(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX signals only")
	}
	var c collector
	if code := shell.Script("kill -9 $$", &c, limits); code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
}
