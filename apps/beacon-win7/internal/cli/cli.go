// Package cli mirrors src/beacon/main.ts: argument parsing, the pair and run
// commands, their messages, and their exit codes.
package cli

import (
	"fmt"
	"regexp"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/keystore"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/pairing"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/runner"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/state"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transport"
)

// Messages and exit codes identical to the TypeScript CLI.
const (
	Usage                 = "usage: kanna-beacon pair <kanna-url> <code> | kanna-beacon run"
	DesktopAppHint        = "This is the command-line beacon. To pair and run it from a window instead, install Kanna Beacon: " + pairing.DownloadPage
	UsageExitCode         = 64
	FailureExitCode       = 1
	IncompatibleExitCode  = 2
	notPairedMessage      = "this machine is not paired. Run: kanna-beacon pair <kanna-url> <code>"
	revokedMessage        = "Kanna no longer knows this beacon. Pair it again: kanna-beacon pair <kanna-url> <code>"
	pairedMessageTemplate = "paired as %s. Start the beacon with: kanna-beacon run"
)

// Command is a parsed invocation.
type Command struct {
	Name     string
	KannaURL string
	Code     string
	Reason   string
}

var (
	kannaURLPattern = regexp.MustCompile(`^https?://[^/\s]+`)
	trailingSlashes = regexp.MustCompile(`/+$`)
)

// ParseArgs mirrors parseBeaconArgs. Unlike the TypeScript CLI, the pairing
// code is normalised (whitespace and dashes removed, upper-cased) so a code
// copied as "abcd-2345" pairs.
func ParseArgs(argv []string) Command {
	if len(argv) == 0 {
		return Command{Name: "invalid", Reason: "missing command"}
	}
	command, rest := argv[0], argv[1:]
	switch command {
	case "run":
		if len(rest) != 0 {
			return Command{Name: "invalid", Reason: "run takes no arguments"}
		}
		return Command{Name: "run"}
	case "pair":
		if len(rest) != 2 {
			return Command{Name: "invalid", Reason: "pair needs <kanna-url> and <code>"}
		}
		if !kannaURLPattern.MatchString(rest[0]) {
			return Command{Name: "invalid", Reason: "kanna-url must start with http:// or https://"}
		}
		return Command{
			Name:     "pair",
			KannaURL: trailingSlashes.ReplaceAllString(rest[0], ""),
			Code:     pairing.NormalizeCode(rest[1]),
		}
	default:
		return Command{Name: "invalid", Reason: "unknown command: " + command}
	}
}

// Deps is everything the CLI touches outside itself.
type Deps struct {
	OS            string
	Hostname      string
	BeaconVersion string
	Home          string
	Pair          func(kannaURL string, request pairing.Request) pairing.Result
	OpenTransport func(url string) transport.Transport
	After         func(time.Duration) <-chan time.Time
	Now           func() time.Time
	Log           func(line string)
}

// Run executes argv and returns the process exit code.
func Run(argv []string, deps Deps) int {
	if deps.Now == nil {
		deps.Now = time.Now
	}
	parsed := ParseArgs(argv)
	switch parsed.Name {
	case "invalid":
		message := parsed.Reason + "\n" + Usage
		if len(argv) == 0 {
			message += "\n" + DesktopAppHint
		}
		deps.Log(message)
		return UsageExitCode
	case "pair":
		return pairMachine(deps, parsed.KannaURL, parsed.Code)
	}
	paired := state.Load(state.Path(deps.Home))
	if paired == nil {
		deps.Log(notPairedMessage)
		return FailureExitCode
	}
	return runBeacon(deps, *paired)
}

func pairMachine(deps Deps, kannaURL, code string) int {
	keys, err := keystore.Open(state.KeyPath(deps.Home))
	if err != nil {
		deps.Log("pairing failed: " + err.Error())
		return FailureExitCode
	}
	result := deps.Pair(kannaURL, pairing.Request{
		Code:      code,
		PublicKey: keys.PublicKeySPKIBase64(),
		Label:     deps.Hostname,
		OS:        deps.OS,
	})
	if !result.OK {
		deps.Log("pairing failed: " + result.Error)
		return FailureExitCode
	}
	if err := state.Save(state.Path(deps.Home), state.State{KannaURL: kannaURL, BeaconID: result.BeaconID}); err != nil {
		deps.Log("pairing failed: " + err.Error())
		return FailureExitCode
	}
	deps.Log(fmt.Sprintf(pairedMessageTemplate, result.BeaconID))
	return 0
}

// DescribeStatus renders a runner status as the CLI's log line, or "" for a
// status the CLI does not report.
func DescribeStatus(status runner.Status, kannaURL string, now time.Time) string {
	switch status.Phase {
	case runner.PhaseOnline:
		return "connected to " + kannaURL
	case runner.PhaseOffline:
		why := "disconnected; "
		if status.Reason == runner.ReasonDisabled {
			why = "Kanna has switched this beacon off; "
		}
		remaining := status.RetryAt.Sub(now).Milliseconds()
		if remaining < 0 {
			remaining = 0
		}
		return fmt.Sprintf("%sreconnecting in %d ms", why, remaining)
	case runner.PhaseRevoked:
		return revokedMessage
	case runner.PhaseIncompatible:
		download := ""
		if status.DownloadURL != nil {
			download = " Download the latest beacon: " + *status.DownloadURL
		}
		return fmt.Sprintf("this beacon is too old for the server (it needs protocol %v or newer).%s", status.MinSupported, download)
	default:
		return ""
	}
}

func runBeacon(deps Deps, paired state.State) int {
	keys, err := keystore.Open(state.KeyPath(deps.Home))
	if err != nil {
		deps.Log(err.Error())
		return FailureExitCode
	}
	beacon := runner.New(runner.Deps{
		State:         paired,
		OS:            deps.OS,
		BeaconVersion: deps.BeaconVersion,
		Signer:        keys,
		OpenTransport: deps.OpenTransport,
		After:         deps.After,
		Now:           deps.Now,
	})
	beacon.Subscribe(func(snapshot runner.Snapshot) {
		if line := DescribeStatus(snapshot.Status, paired.KannaURL, deps.Now()); line != "" {
			deps.Log(line)
		}
	})
	switch beacon.Run() {
	case runner.ExitIncompatible:
		return IncompatibleExitCode
	case runner.ExitRevoked:
		return FailureExitCode
	default:
		return 0
	}
}
