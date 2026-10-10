package selfupdate

import (
	"fmt"
	"strings"
)

// Release locations and file names, as published by the beacon-win7 job in
// .github/workflows/release-please.yml.
const (
	DefaultReleaseBase = "https://github.com/cuongtranba/kanna/releases/download"
	ChecksumFile       = "SHA256SUMS-win7"
)

// Environment variables a machine sets to change how it updates. The server
// cannot set either.
const (
	AutoUpdateEnv  = "KANNA_BEACON_AUTO_UPDATE"
	ReleaseBaseEnv = "KANNA_BEACON_RELEASE_BASE"
)

// Kind is which Windows 7 program is updating.
type Kind int

// Kinds.
const (
	CLI Kind = iota
	Tray
)

// AssetName is the release file for kind on goos/goarch:
// kanna-beacon-win7-{x64|x86}.exe or kanna-beacon-tray-win7-{x64|x86}.exe.
// Only Windows builds are published, so any other system has no asset.
func AssetName(kind Kind, goos, goarch string) (string, error) {
	if goos != "windows" {
		return "", fmt.Errorf("no Windows 7 beacon is published for %s; self-update needs a Windows build", goos)
	}
	var label string
	switch goarch {
	case "amd64":
		label = "x64"
	case "386":
		label = "x86"
	default:
		return "", fmt.Errorf("no Windows 7 beacon is published for %s", goarch)
	}
	if kind == Tray {
		return "kanna-beacon-tray-win7-" + label + ".exe", nil
	}
	return "kanna-beacon-win7-" + label + ".exe", nil
}

// ParseChecksums reads sha256sum output, one "<hex>  <name>" line per file
// (or "<hex> *<name>" in binary mode), into a map from name to lower-case
// hex digest. Lines that do not have that shape are skipped.
func ParseChecksums(text string) map[string]string {
	sums := make(map[string]string)
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimRight(line, "\r")
		if len(line) < 66 || line[64] != ' ' {
			continue
		}
		digest := strings.ToLower(line[:64])
		if !isHex(digest) {
			continue
		}
		name := line[65:]
		if name[0] == ' ' || name[0] == '*' {
			name = name[1:]
		}
		if name != "" {
			sums[name] = digest
		}
	}
	return sums
}

func isHex(text string) bool {
	for index := 0; index < len(text); index++ {
		c := text[index]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// Settings is how this machine wants to be updated.
type Settings struct {
	AutoUpdate  bool
	ReleaseBase string
}

// FromEnvironment reads Settings: KANNA_BEACON_AUTO_UPDATE=disabled turns the
// automatic update off (the Update now button still works), and
// KANNA_BEACON_RELEASE_BASE replaces the GitHub release download location.
func FromEnvironment(getenv func(string) string) Settings {
	base := strings.TrimSpace(getenv(ReleaseBaseEnv))
	if base == "" {
		base = DefaultReleaseBase
	}
	return Settings{
		AutoUpdate:  strings.TrimSpace(strings.ToLower(getenv(AutoUpdateEnv))) != "disabled",
		ReleaseBase: base,
	}
}
