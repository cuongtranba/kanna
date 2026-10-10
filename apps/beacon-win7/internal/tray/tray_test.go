package tray_test

import (
	"strings"
	"testing"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/runner"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/tray"
)

func TestStatusLabel(t *testing.T) {
	now := time.Unix(100, 0)
	const url = "https://kanna.example:8443/base"
	cases := []struct {
		status runner.Status
		want   string
	}{
		{runner.Status{Phase: runner.PhaseConnecting}, "Connecting to kanna.example:8443"},
		{runner.Status{Phase: runner.PhaseOnline}, "Online: connected to kanna.example:8443"},
		{runner.Status{Phase: runner.PhaseOffline, RetryAt: now.Add(1500 * time.Millisecond)}, "Offline, trying again in 2s"},
		{runner.Status{Phase: runner.PhaseOffline, RetryAt: now.Add(-time.Second), Reason: runner.ReasonDisabled}, "Switched off in Kanna, trying again in 0s"},
		{runner.Status{Phase: runner.PhaseRevoked}, "Removed from Kanna. Pair it again"},
		{runner.Status{Phase: runner.PhaseIncompatible, MinSupported: 5}, "Update needed: this beacon is too old for your Kanna"},
		{runner.Status{Phase: runner.PhaseIncompatible, MinSupported: 1}, "Update Kanna: this beacon is newer than your Kanna"},
		{runner.Status{Phase: runner.PhaseUpdating, Version: "1.71.0", Step: protocol.UpdateChecking}, "Updating to 1.71.0..."},
		{runner.Status{Phase: runner.PhaseUpdating, Version: "1.71.0", Step: protocol.UpdateDownloading}, "Updating to 1.71.0..."},
		{runner.Status{Phase: runner.PhaseUpdating, Version: "1.71.0", Step: protocol.UpdateInstalling}, "Updating to 1.71.0..."},
		{runner.Status{Phase: runner.PhaseUpdating, Version: "1.71.0", Step: protocol.UpdateRestarting}, "Restarting into 1.71.0..."},
		{runner.Status{Phase: runner.PhaseUpdating, Version: "1.71.0", Step: protocol.UpdateFailed, Message: "no asset"}, "Update to 1.71.0 failed: no asset"},
		{runner.Status{Phase: runner.PhaseStopped}, "Stopped"},
	}
	for _, tc := range cases {
		if got := tray.StatusLabel(tc.status, url, now); got != tc.want {
			t.Errorf("StatusLabel(%+v) = %q, want %q", tc.status, got, tc.want)
		}
	}
}

func TestLinkArgumentFindsThePairingLink(t *testing.T) {
	if got := tray.LinkArgument([]string{"--flag", "KANNA-BEACON://pair?url=x&code=y"}); got != "KANNA-BEACON://pair?url=x&code=y" {
		t.Fatalf("LinkArgument = %q", got)
	}
	if got := tray.LinkArgument([]string{"run"}); got != "" {
		t.Fatalf("LinkArgument = %q", got)
	}
}

func TestClipboardTargetPairsFromACopiedCommand(t *testing.T) {
	target, problem := tray.ClipboardTarget("kanna-beacon pair https://kanna.example.com ABCD2345")
	if problem != "" || target.KannaURL != "https://kanna.example.com" || target.Code != "ABCD2345" {
		t.Fatalf("ClipboardTarget = %+v, %q", target, problem)
	}
}

func TestClipboardTargetExplainsWhyCopiedTextCannotPair(t *testing.T) {
	cases := map[string]string{
		"   ":                   tray.ClipboardEmpty,
		"hello from the sender": tray.NoPairingFound,
	}
	for text, want := range cases {
		if _, problem := tray.ClipboardTarget(text); problem != want {
			t.Errorf("ClipboardTarget(%q) problem = %q, want %q", text, problem, want)
		}
	}
}

func TestClipboardTargetRefusesTheSendersOwnLocalAddress(t *testing.T) {
	for _, address := range []string{"http://localhost:5174", "http://127.0.0.1:5174", "http://0.0.0.0:5175", "http://[::1]:5174"} {
		_, problem := tray.ClipboardTarget("kanna-beacon pair " + address + " ABCD2345")
		if !strings.Contains(problem, "sender's own computer") {
			t.Errorf("%s: problem = %q", address, problem)
		}
	}
}

func TestDescribePairingFailureSaysWhatToDoNext(t *testing.T) {
	const kannaURL = "https://kanna.example.com"
	if got := tray.DescribePairingFailure(kannaURL, "expired"); !strings.Contains(got, "Ask for a new one") {
		t.Errorf("expired: %q", got)
	}
	if got := tray.DescribePairingFailure(kannaURL, "unknown"); !strings.Contains(got, "Ask for a new one") {
		t.Errorf("unknown: %q", got)
	}
	if got := tray.DescribePairingFailure(kannaURL, "Beacons require a password"); !strings.Contains(got, "no password set") {
		t.Errorf("password: %q", got)
	}
	if got := tray.DescribePairingFailure(kannaURL, "dial tcp: i/o timeout"); !strings.Contains(got, "dial tcp: i/o timeout") || !strings.Contains(got, kannaURL) {
		t.Errorf("network: %q", got)
	}
}

func TestRelaunchArgsDropThePairingLinkItAlreadyRedeemed(t *testing.T) {
	cases := []struct {
		args []string
		want string
	}{
		{nil, ""},
		{[]string{"kanna-beacon://pair?url=x&code=y"}, ""},
		{[]string{"--flag", "kanna-beacon://pair?url=x&code=y"}, "--flag"},
		{[]string{"--flag"}, "--flag"},
	}
	for _, tc := range cases {
		if got := strings.Join(tray.RelaunchArgs(tc.args), " "); got != tc.want {
			t.Errorf("RelaunchArgs(%q) = %q, want %q", tc.args, got, tc.want)
		}
	}
}
