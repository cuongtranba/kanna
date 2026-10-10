package cli

import (
	"errors"
	"os"
	"os/exec"
	"runtime"
)

// SupervisedEnv marks a beacon started by a supervising beacon. A supervised
// beacon that updated itself exits with RestartExitCode and its supervisor
// starts the new build.
const SupervisedEnv = "KANNA_BEACON_SUPERVISED"

// Child is one run of the beacon under a supervisor.
type Child interface {
	// Wait blocks until the child exits and returns its exit code.
	Wait() int
	// Signal forwards a signal the supervisor received.
	Signal(sig os.Signal)
}

// Supervise keeps the beacon in the foreground across updates, so a
// terminal, a scheduled task or a service manager sees one long-lived
// process. It starts a child with spawn, forwards every signal on signals to
// it, starts another whenever the child exits with RestartExitCode, and
// otherwise returns the child's exit code.
func Supervise(spawn func() (Child, error), signals <-chan os.Signal, log func(line string)) int {
	for {
		child, err := spawn()
		if err != nil {
			log("could not start the updated beacon: " + err.Error())
			return FailureExitCode
		}
		done := make(chan int, 1)
		go func() { done <- child.Wait() }()
		code := waitForChild(child, done, signals)
		if code != RestartExitCode {
			return code
		}
	}
}

func waitForChild(child Child, done <-chan int, signals <-chan os.Signal) int {
	for {
		select {
		case code := <-done:
			return code
		case sig := <-signals:
			child.Signal(sig)
		}
	}
}

type processChild struct {
	command *exec.Cmd
}

func (c processChild) Wait() int {
	err := c.command.Wait()
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && exitErr.ExitCode() >= 0 {
		return exitErr.ExitCode()
	}
	return FailureExitCode
}

// Signal forwards sig on Unix. On Windows a console delivers Ctrl+C to every
// process attached to it, the child included, so there is nothing to
// forward; Go cannot send an interrupt to another Windows process anyway.
func (c processChild) Signal(sig os.Signal) {
	if runtime.GOOS == "windows" || c.command.Process == nil {
		return
	}
	_ = c.command.Process.Signal(sig)
}

// SpawnSelf starts exe with args, the terminal's standard streams, and the
// environment plus KANNA_BEACON_SUPERVISED=1. exe must be the path captured
// before the update, which the new build now occupies.
func SpawnSelf(exe string, args []string) func() (Child, error) {
	return func() (Child, error) {
		command := exec.Command(exe, args...)
		command.Stdin = os.Stdin
		command.Stdout = os.Stdout
		command.Stderr = os.Stderr
		command.Env = append(os.Environ(), SupervisedEnv+"=1")
		if err := command.Start(); err != nil {
			return nil, err
		}
		return processChild{command: command}, nil
	}
}
