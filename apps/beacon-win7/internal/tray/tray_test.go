package tray_test

import (
	"testing"
	"time"

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
		{runner.Status{Phase: runner.PhaseIncompatible}, "Update needed: this beacon is too old for your Kanna"},
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
