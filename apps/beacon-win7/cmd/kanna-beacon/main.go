// Command kanna-beacon is the console beacon for Windows 7, a port of
// src/beacon/entry.adapter.ts. It prints the same messages and exits with the
// same codes as the Bun build.
package main

import (
	"bufio"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/cli"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/pairing"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/selfupdate"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/state"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transport"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/version"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/winsys"
)

func beaconOS() string {
	switch runtime.GOOS {
	case "darwin":
		return protocol.OSDarwin
	case "windows":
		return protocol.OSWindows
	default:
		return protocol.OSLinux
	}
}

func logLine(line string) {
	fmt.Fprintln(os.Stderr, line)
}

func printLine(line string) {
	fmt.Fprintln(os.Stdout, line)
}

func main() {
	argv := os.Args[1:]
	// The path is read before anything can replace the file behind it; the
	// supervisor restarts whatever build occupies it after an update.
	exe, _ := os.Executable()
	if exe != "" && len(argv) > 0 && argv[0] == "run" {
		_ = selfupdate.CleanupLeftovers(exe)
	}
	home, err := state.Home()
	if err != nil {
		logLine(err.Error())
		os.Exit(cli.FailureExitCode)
	}
	hostname, _ := os.Hostname()
	settings := selfupdate.FromEnvironment(os.Getenv)
	code := cli.Run(argv, cli.Deps{
		OS:            beaconOS(),
		Hostname:      hostname,
		BeaconVersion: version.Version,
		Home:          home,
		Pair:          pairing.Pair,
		OpenTransport: func(url string) transport.Transport { return transport.Dial(url) },
		Log:           logLine,
		Print:         printLine,
		Updater: selfupdate.NewUpdater(selfupdate.Options{
			Kind:           selfupdate.CLI,
			ExecPath:       exe,
			CurrentVersion: version.Version,
			ReleaseBase:    settings.ReleaseBase,
		}),
		AutoUpdate: settings.AutoUpdate && !strings.HasSuffix(version.Version, "-dev"),
	})
	if code == cli.RestartExitCode && os.Getenv(cli.SupervisedEnv) != "1" {
		code = supervise(exe, argv)
	}
	if runtime.GOOS == "windows" && len(argv) == 0 && winsys.IsConsole(os.Stdin) {
		fmt.Fprint(os.Stderr, "\nPress Enter to close this window.\n")
		_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	}
	os.Exit(code)
}

// supervise turns this process, whose beacon just updated itself, into the
// supervisor of the new build, so whatever started kanna-beacon run keeps
// seeing one process.
func supervise(exe string, argv []string) int {
	if exe == "" {
		logLine("updated, but cannot find this executable to restart it; start kanna-beacon run again")
		return cli.FailureExitCode
	}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	return cli.Supervise(cli.SpawnSelf(exe, argv), signals, logLine)
}
