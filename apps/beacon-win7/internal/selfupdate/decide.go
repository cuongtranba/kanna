// Package selfupdate replaces the running Windows 7 beacon with the release
// matching its Kanna server's version. It mirrors src/beacon/self-update.ts
// (the decision) and src/beacon/self-update.adapter.ts (the download, the
// checksum, the smoke test and the swap).
//
// The server never names a URL or a version in an update request: the
// version comes from the handshake, is acted on only when it is newer than
// this beacon, and is fetched only from the fixed GitHub release download
// location, verified against that release's SHA256SUMS-win7.
package selfupdate

import (
	"regexp"
	"time"
)

// RetryBackoff spaces automatic retries of a version that failed to install.
// The release jobs run in parallel, so Kanna can announce a version whose
// Windows 7 assets are not uploaded yet.
const RetryBackoff = 30 * time.Minute

// Trigger says what asked for an update.
type Trigger int

// Triggers.
const (
	// Auto is a connection to a Kanna newer than this beacon.
	Auto Trigger = iota
	// Manual is the Update now button in Kanna.
	Manual
)

// Failure records the last version that failed to install, and when.
type Failure struct {
	Version string
	At      time.Time
}

// DecisionKind is what Decide concluded.
type DecisionKind int

// Decisions.
const (
	// None does nothing and reports nothing.
	None DecisionKind = iota
	// Current reports that this beacon is already up to date.
	Current
	// Install updates to Decision.Version.
	Install
)

// Decision is Decide's verdict. Version is the version to install, or for
// Current the version this beacon already runs.
type Decision struct {
	Kind    DecisionKind
	Version string
}

var releaseVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`)

// ValidVersion reports whether version has the shape of a Kanna release
// version. The version reaches a URL path, so nothing else is accepted.
func ValidVersion(version string) bool {
	return releaseVersion.MatchString(version)
}

// Decide applies the update rule. It never targets a version that is not
// newer than this beacon, so a beacon is never downgraded. With auto-update
// off only a manual trigger proceeds, and an automatic retry of a version
// that failed less than RetryBackoff ago is skipped; a manual trigger ignores
// that backoff.
func Decide(beaconVersion, serverVersion string, trigger Trigger, autoEnabled bool, lastFailure *Failure, now time.Time) Decision {
	if !ValidVersion(serverVersion) {
		return Decision{Kind: None}
	}
	if !IsBehind(beaconVersion, serverVersion) {
		if trigger == Manual {
			return Decision{Kind: Current, Version: beaconVersion}
		}
		return Decision{Kind: None}
	}
	if trigger == Auto {
		if !autoEnabled {
			return Decision{Kind: None}
		}
		if lastFailure != nil && lastFailure.Version == serverVersion && now.Sub(lastFailure.At) < RetryBackoff {
			return Decision{Kind: None}
		}
	}
	return Decision{Kind: Install, Version: serverVersion}
}

// IsBehind mirrors isBeaconBehind in src/shared/beacon-status.ts: a leading v
// and any -suffix are dropped, the dotted parts compare numerically with a
// missing part read as 0, and a part that is not a number falls back to
// comparing the whole strings.
func IsBehind(beaconVersion, serverVersion string) bool {
	if beaconVersion == serverVersion {
		return false
	}
	beacon := versionParts(beaconVersion)
	server := versionParts(serverVersion)
	length := len(beacon)
	if len(server) > length {
		length = len(server)
	}
	for index := 0; index < length; index++ {
		left, right := part(beacon, index), part(server, index)
		if !left.ok || !right.ok {
			return beaconVersion < serverVersion
		}
		if left.value != right.value {
			return left.value < right.value
		}
	}
	return false
}

type number struct {
	value int
	ok    bool
}

func part(parts []number, index int) number {
	if index < len(parts) {
		return parts[index]
	}
	return number{ok: true}
}

func versionParts(version string) []number {
	if len(version) > 0 && version[0] == 'v' {
		version = version[1:]
	}
	for index := 0; index < len(version); index++ {
		if version[index] == '-' {
			version = version[:index]
			break
		}
	}
	var parts []number
	start := 0
	for index := 0; index <= len(version); index++ {
		if index == len(version) || version[index] == '.' {
			parts = append(parts, parseLeadingInt(version[start:index]))
			start = index + 1
		}
	}
	return parts
}

// parseLeadingInt reads the digits at the start of text the way JavaScript's
// parseInt does: "7rc" is 7, and text with no leading digit is not a number.
func parseLeadingInt(text string) number {
	index := 0
	for index < len(text) && (text[index] == ' ' || text[index] == '\t') {
		index++
	}
	negative := false
	if index < len(text) && (text[index] == '+' || text[index] == '-') {
		negative = text[index] == '-'
		index++
	}
	value, digits := 0, 0
	for index < len(text) && text[index] >= '0' && text[index] <= '9' {
		value = value*10 + int(text[index]-'0')
		index++
		digits++
	}
	if digits == 0 {
		return number{}
	}
	if negative {
		value = -value
	}
	return number{value: value, ok: true}
}
