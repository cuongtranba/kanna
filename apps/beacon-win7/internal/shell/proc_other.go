//go:build !windows

package shell

import (
	"os/exec"
	"syscall"
)

func prepare(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func scriptCommand(body string) *exec.Cmd {
	return exec.Command("/bin/sh", "-lc", body)
}

// killTree kills the child's whole process group, falling back to the child.
func killTree(command *exec.Cmd) {
	if command.Process == nil {
		return
	}
	if err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL); err != nil {
		_ = command.Process.Kill()
	}
}
