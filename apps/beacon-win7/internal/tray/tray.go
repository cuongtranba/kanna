// Package tray holds the platform-neutral part of the Windows 7 tray: the
// words it shows for each runner status and the link it was launched with.
package tray

import (
	"fmt"
	"math"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/pairing"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
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
	NotPairedLabel = "Not paired. Copy the pairing command from Kanna, then choose Pair from copied text"

	PairFromClipboardLabel = "Pair from copied text..."
	PairFromClipboardHint  = "Pairs with a kanna-beacon link or pairing command you copied, for example from a chat message"
)

// Explanations shown when copied text cannot be used to pair.
const (
	ClipboardEmpty = "Nothing is copied.\n\n" +
		"In Kanna, open Settings, Beacons, Pair a machine, and press the copy button next to the pairing command. " +
		"If someone else runs Kanna, ask them to send you that command, copy their whole message, then choose Pair from copied text again."
	NoPairingFound = "The copied text has no pairing command or link.\n\n" +
		"It should look like: kanna-beacon pair https://your-kanna-address ABCD2345\n\n" +
		"Copy the whole command from Kanna (Settings, Beacons, Pair a machine), or the whole message someone sent you, then try again."
	loopbackTemplate = "The copied command points at %s, which is the sender's own computer, so this computer cannot reach it.\n\n" +
		"Ask them to open Kanna by an address this computer can reach (not localhost or 127.0.0.1), then send a new pairing command."
	codeExpired = "This pairing code has expired or was already used. A code works once and only for 5 minutes.\n\n" +
		"Ask for a new one in Kanna: Settings, Beacons, Pair a machine."
	passwordMissingTemplate = "Kanna at %s has no password set, and beacons need one.\n\n" +
		"Ask the person running Kanna to set a password, then send a new pairing command."
	pairingFailedTemplate = "Pairing with %s failed: %s\n\nCheck that this computer can open %s in a browser."
)

// ClipboardTarget turns copied text into a pairing target. When the text
// cannot be used it returns an explanation a person can act on instead.
func ClipboardTarget(text string) (pairing.Target, string) {
	if strings.TrimSpace(text) == "" {
		return pairing.Target{}, ClipboardEmpty
	}
	target, ok := pairing.FindInText(text)
	if !ok {
		return pairing.Target{}, NoPairingFound
	}
	if isLoopback(target.KannaURL) {
		return pairing.Target{}, fmt.Sprintf(loopbackTemplate, HostOf(target.KannaURL))
	}
	return target, ""
}

func isLoopback(kannaURL string) bool {
	parsed, err := url.Parse(kannaURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsUnspecified())
}

// DescribePairingFailure explains a failed pairing request in words that say
// what to do next, from the reason pairing.Pair reported.
func DescribePairingFailure(kannaURL, reason string) string {
	switch reason {
	case "expired", "unknown":
		return codeExpired
	case "Beacons require a password":
		return fmt.Sprintf(passwordMissingTemplate, HostOf(kannaURL))
	}
	return fmt.Sprintf(pairingFailedTemplate, HostOf(kannaURL), reason, kannaURL)
}

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
		if status.MinSupported <= protocol.BeaconProtocolVersion {
			return "Update Kanna: this beacon is newer than your Kanna"
		}
		return "Update needed: this beacon is too old for your Kanna"
	case runner.PhaseUpdating:
		switch status.Step {
		case protocol.UpdateRestarting:
			return "Restarting into " + status.Version + "..."
		case protocol.UpdateFailed:
			return "Update to " + status.Version + " failed: " + status.Message
		default:
			return "Updating to " + status.Version + "..."
		}
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

// RelaunchArgs are the arguments the tray restarts itself with after an
// update: its own, less a pairing link, which was redeemed when it started
// and would only fail as an expired code.
func RelaunchArgs(args []string) []string {
	link := LinkArgument(args)
	kept := []string{}
	for _, arg := range args {
		if link == "" || arg != link {
			kept = append(kept, arg)
		}
	}
	return kept
}
