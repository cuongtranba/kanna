// Package pairing mirrors src/beacon/pair-client.adapter.ts and
// src/shared/beacon-pair-link.ts: exchanging a pairing code for a beacon id,
// and reading the kanna-beacon://pair link Kanna hands out.
package pairing

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"unicode"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transport"
)

// Link and code constants shared with the TypeScript beacon.
const (
	LinkScheme   = "kanna-beacon"
	CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	CodeLength   = 8
	DownloadPage = "https://github.com/cuongtranba/kanna/releases/latest"
)

// Request is the body POSTed to /beacon/pair, in the TypeScript key order.
type Request struct {
	Code      string `json:"code"`
	PublicKey string `json:"publicKey"`
	Label     string `json:"label"`
	OS        string `json:"os"`
}

// Result is a pairing outcome. Status is zero when no response arrived.
type Result struct {
	OK       bool
	BeaconID string
	Error    string
	Status   int
}

// Pair exchanges the code in request for a beacon id.
func Pair(kannaURL string, request Request) Result {
	host := ""
	if parsed, err := url.Parse(kannaURL); err == nil {
		host = parsed.Hostname()
	}
	return pairWith(transport.HTTPClient(host), kannaURL, request)
}

func pairWith(client *http.Client, kannaURL string, request Request) Result {
	body, err := json.Marshal(request)
	if err != nil {
		return Result{Error: err.Error()}
	}
	response, err := client.Post(kannaURL+"/beacon/pair", "application/json", bytes.NewReader(body))
	if err != nil {
		return Result{Error: err.Error()}
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return Result{Error: err.Error()}
	}
	text := string(raw)
	var parsed map[string]any
	isObject := json.Unmarshal(raw, &parsed) == nil && parsed != nil
	if response.StatusCode >= 200 && response.StatusCode < 300 && isObject {
		if beaconID, ok := parsed["beaconId"].(string); ok {
			return Result{OK: true, BeaconID: beaconID}
		}
	}
	return Result{Error: describeFailure(response.StatusCode, text, parsed), Status: response.StatusCode}
}

func describeFailure(status int, body string, parsed map[string]any) string {
	if message, ok := parsed["error"].(string); ok {
		return message
	}
	if trimmed := strings.TrimSpace(body); trimmed != "" {
		return trimmed
	}
	return fmt.Sprintf("HTTP %d", status)
}

// NormalizeCode strips whitespace and dashes and upper-cases the rest, so a
// code typed as "abcd-2345" is sent as "ABCD2345".
func NormalizeCode(raw string) string {
	stripped := strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || r == '-' || r == 0xFEFF {
			return -1
		}
		return r
	}, raw)
	return strings.ToUpper(stripped)
}

// Target is where and how to pair.
type Target struct {
	KannaURL string
	Code     string
}

var (
	codePattern = regexp.MustCompile(`^[` + CodeAlphabet + `]{` + fmt.Sprint(CodeLength) + `}$`)
	cliPair     = regexp.MustCompile(`(?i)(?:^|[\s"'\\/])kanna-beacon(?:\.exe)?["']?\s+pair\s+(\S+)\s+(\S+)\s*$`)
	trailing    = regexp.MustCompile(`/+$`)
)

func normalizeKannaURL(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	parsed, err := url.Parse(trimmed)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", false
	}
	return trailing.ReplaceAllString(trimmed, ""), true
}

func toTarget(rawURL, rawCode string) (Target, bool) {
	kannaURL, urlOK := normalizeKannaURL(rawURL)
	code := NormalizeCode(rawCode)
	if !urlOK || !codePattern.MatchString(code) {
		return Target{}, false
	}
	return Target{KannaURL: kannaURL, Code: code}, true
}

func parseLink(text string) (Target, bool) {
	parsed, err := url.Parse(text)
	if err != nil || parsed.Scheme != LinkScheme {
		return Target{}, false
	}
	action := parsed.Host
	if action == "" {
		action = strings.TrimLeft(parsed.Path, "/")
	}
	if action != "pair" {
		return Target{}, false
	}
	query := parsed.Query()
	if !query.Has("url") || !query.Has("code") {
		return Target{}, false
	}
	return toTarget(query.Get("url"), query.Get("code"))
}

// ParseInput accepts a kanna-beacon://pair link or a pasted
// "kanna-beacon pair <url> <code>" command, as parseBeaconPairingInput does.
func ParseInput(input string) (Target, bool) {
	text := strings.TrimSpace(input)
	if text == "" {
		return Target{}, false
	}
	if strings.HasPrefix(strings.ToLower(text), LinkScheme+"://") {
		return parseLink(text)
	}
	match := cliPair.FindStringSubmatch(text)
	if match == nil {
		return Target{}, false
	}
	return toTarget(match[1], match[2])
}

// BuildLink renders the link Kanna shows for a pairing target.
func BuildLink(target Target) string {
	return LinkScheme + "://pair?url=" + encodeURIComponent(target.KannaURL) + "&code=" + encodeURIComponent(target.Code)
}

func encodeURIComponent(value string) string {
	escaped := url.QueryEscape(value)
	escaped = strings.ReplaceAll(escaped, "+", "%20")
	for _, keep := range []string{"!", "'", "(", ")", "*"} {
		escaped = strings.ReplaceAll(escaped, url.QueryEscape(keep), keep)
	}
	return escaped
}
