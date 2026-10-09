// Package shell mirrors src/beacon/shell.adapter.ts: it runs a command or a
// script, streams its output under a shared byte cap, and enforces a timeout.
package shell

import (
	"errors"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/utf8lossy"
)

// Exit codes the TypeScript beacon reports for its own failures.
const (
	TimeoutExitCode      = 124
	SpawnFailureExitCode = 127
)

// Sink receives a command's output as UTF-8 text.
type Sink interface {
	Stdout(chunk string)
	Stderr(chunk string)
}

// Limits bound one command.
type Limits struct {
	Timeout       time.Duration
	TimeoutMs     float64
	OutputByteCap int64
}

// LimitsFromScope converts the scope's millisecond and byte numbers.
func LimitsFromScope(timeoutMs, outputByteCap float64) Limits {
	return Limits{
		Timeout:       time.Duration(timeoutMs * float64(time.Millisecond)),
		TimeoutMs:     timeoutMs,
		OutputByteCap: int64(outputByteCap),
	}
}

// Exec runs cmd with args directly, without a shell. An empty cwd inherits
// the beacon's working directory.
func Exec(cmd string, args []string, cwd string, sink Sink, limits Limits) int {
	command := exec.Command(cmd, args...)
	command.Dir = cwd
	return run(command, sink, limits)
}

// Script runs body through the platform shell: powershell.exe -NoProfile
// -Command on Windows, /bin/sh -lc elsewhere.
func Script(body string, sink Sink, limits Limits) int {
	return run(scriptCommand(body), sink, limits)
}

type forwarder struct {
	mu        sync.Mutex
	sink      Sink
	cap       int64
	forwarded int64
	truncated bool
	settled   bool
}

func (f *forwarder) forward(write func(string), chunk string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.settled || f.truncated || chunk == "" {
		return
	}
	room := f.cap - f.forwarded
	size := int64(len(chunk))
	if size <= room {
		f.forwarded += size
		write(chunk)
		return
	}
	f.truncated = true
	if room > 0 {
		write(utf8lossy.String([]byte(chunk)[:room]))
	}
	f.sink.Stderr(fmt.Sprintf("\n[output truncated at %d bytes]\n", f.cap))
}

func (f *forwarder) settle(final func()) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.settled {
		return false
	}
	f.settled = true
	if final != nil {
		final()
	}
	return true
}

func pump(reader io.Reader, write func(string), f *forwarder, done *sync.WaitGroup) {
	defer done.Done()
	var decoder utf8lossy.Decoder
	buffer := make([]byte, 64*1024)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			f.forward(write, decoder.Decode(buffer[:n]))
		}
		if err != nil {
			f.forward(write, decoder.Flush())
			return
		}
	}
}

func run(command *exec.Cmd, sink Sink, limits Limits) int {
	prepare(command)
	f := &forwarder{sink: sink, cap: limits.OutputByteCap}
	stdout, stdoutErr := command.StdoutPipe()
	stderr, stderrErr := command.StderrPipe()
	if err := errors.Join(stdoutErr, stderrErr); err != nil {
		sink.Stderr(err.Error() + "\n")
		return SpawnFailureExitCode
	}
	if err := command.Start(); err != nil {
		sink.Stderr(err.Error() + "\n")
		return SpawnFailureExitCode
	}
	result := make(chan int, 1)
	go func() {
		var pumps sync.WaitGroup
		pumps.Add(2)
		go pump(stdout, sink.Stdout, f, &pumps)
		go pump(stderr, sink.Stderr, f, &pumps)
		pumps.Wait()
		err := command.Wait()
		result <- exitCode(command, err)
	}()
	timer := time.NewTimer(limits.Timeout)
	defer timer.Stop()
	select {
	case code := <-result:
		f.settle(nil)
		return code
	case <-timer.C:
		killTree(command)
		stdout.Close()
		stderr.Close()
		f.settle(func() {
			sink.Stderr(fmt.Sprintf("\n[timed out after %s ms]\n", formatMs(limits.TimeoutMs)))
		})
		return TimeoutExitCode
	}
}

func exitCode(command *exec.Cmd, err error) int {
	state := command.ProcessState
	if state == nil {
		return 1
	}
	if code := state.ExitCode(); code >= 0 {
		return code
	}
	return 1
}

func formatMs(ms float64) string {
	if ms == float64(int64(ms)) {
		return fmt.Sprintf("%d", int64(ms))
	}
	return fmt.Sprintf("%v", ms)
}
