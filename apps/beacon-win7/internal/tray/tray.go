// Package tray holds the platform-neutral part of the Windows 7 tray: the
// words it shows for each runner status and the link it was launched with.
package tray

import (
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/pairing"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/runner"
)

// Names the tray registers under. They differ from the Electrobun desktop
// app's ("Kanna Beacon", dev.kanna.beacon) so the two never overwrite each
// other's start-at-login entry.
const (
	AppName        = "Kanna Beacon"
	RunValueName   = "Kanna Beacon (Windows 7)"
	URLDescription = "Kanna Beacon (Windows 7)"
	OwnerMarker    = "kanna-beacon-tray"
	MutexName      = `Local\KannaBeaconWin7Tray`
	ReloadEvent    = `Local\KannaBeaconWin7TrayReload`
	UnpairTimeout  = 5 * time.Second
	NotPairedLabel = "Not paired. In Kanna, open Settings, Beacons, Pair a machine"
)

// HostOf returns the host part of a Kanna URL for display.
func HostOf(kannaURL string) string {
	if parsed, err := url.Parse(kannaURL); err == nil && parsed.Host != "" {
		return parsed.Host
	}
	return kannaURL
}

// Online reports whether the status should show the online icon.
func Online(status runner.Status) bool {
	return status.Phase == runner.PhaseOnline
}

// StatusLabel is the first, disabled line of the tray menu.
func StatusLabel(status runner.Status, kannaURL string, now time.Time) string {
	host := HostOf(kannaURL)
	switch status.Phase {
	case runner.PhaseConnecting:
		return "Connecting to " + host
	case runner.PhaseOnline:
		return "Online: connected to " + host
	case runner.PhaseOffline:
		seconds := int(math.Ceil(status.RetryAt.Sub(now).Seconds()))
		if seconds < 0 {
			seconds = 0
		}
		if status.Reason == runner.ReasonDisabled {
			return fmt.Sprintf("Switched off in Kanna, trying again in %ds", seconds)
		}
		return fmt.Sprintf("Offline, trying again in %ds", seconds)
	case runner.PhaseRevoked:
		return "Removed from Kanna. Pair it again"
	case runner.PhaseIncompatible:
		return "Update needed: this beacon is too old for your Kanna"
	default:
		return "Stopped"
	}
}

// LinkArgument returns the kanna-beacon:// argument Windows passes when a
// pairing link is clicked, or "" when there is none.
func LinkArgument(args []string) string {
	for _, arg := range args {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(arg)), pairing.LinkScheme+"://") {
			return arg
		}
	}
	return ""
}
