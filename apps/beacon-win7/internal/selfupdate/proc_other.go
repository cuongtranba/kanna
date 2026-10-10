//go:build !windows

package selfupdate

import "os/exec"

func hideWindow(*exec.Cmd) {}
