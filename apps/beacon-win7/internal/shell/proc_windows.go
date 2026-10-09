//go:build windows

package shell

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

func prepare(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

func scriptCommand(body string) *exec.Cmd {
	return exec.Command("powershell.exe", "-NoProfile", "-Command", body)
}

// killTree kills only the direct child, as the TypeScript beacon does on
// Windows.
func killTree(command *exec.Cmd) {
	if command.Process != nil {
		_ = command.Process.Kill()
	}
}
