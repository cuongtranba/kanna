// Command kanna-beacon is the console beacon for Windows 7, a port of
// src/beacon/entry.adapter.ts. It prints the same messages and exits with the
// same codes as the Bun build.
package main

import (
	"bufio"
	"fmt"
	"os"
	"runtime"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/cli"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/pairing"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
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

func main() {
	argv := os.Args[1:]
	home, err := state.Home()
	if err != nil {
		logLine(err.Error())
		os.Exit(cli.FailureExitCode)
	}
	hostname, _ := os.Hostname()
	code := cli.Run(argv, cli.Deps{
		OS:            beaconOS(),
		Hostname:      hostname,
		BeaconVersion: version.Version,
		Home:          home,
		Pair:          pairing.Pair,
		OpenTransport: func(url string) transport.Transport { return transport.Dial(url) },
		Log:           logLine,
	})
	if runtime.GOOS == "windows" && len(argv) == 0 && winsys.IsConsole(os.Stdin) {
		fmt.Fprint(os.Stderr, "\nPress Enter to close this window.\n")
		_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	}
	os.Exit(code)
}
