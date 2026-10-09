package pairing

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func pairingServer(t *testing.T, status int, body string, seen *string) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if seen != nil {
			*seen = r.Method + " " + r.URL.Path + " " + r.Header.Get("Content-Type") + " " + string(raw)
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(server.Close)
	return server.URL
}

var request = Request{Code: "ABCD2345", PublicKey: "PUB", Label: "box", OS: "windows"}

func TestPairPostsTheRequestAndReturnsTheBeaconID(t *testing.T) {
	var seen string
	url := pairingServer(t, 200, `{"ok":true,"beaconId":"b-9"}`, &seen)
	got := Pair(url, request)
	if !got.OK || got.BeaconID != "b-9" {
		t.Fatalf("Pair = %+v", got)
	}
	want := `POST /beacon/pair application/json {"code":"ABCD2345","publicKey":"PUB","label":"box","os":"windows"}`
	if seen != want {
		t.Fatalf("server saw %q, want %q", seen, want)
	}
}

func TestPairDescribesAFailureFromTheBestAvailableText(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{name: "json error", status: 400, body: `{"ok":false,"error":"expired"}`, want: "expired"},
		{name: "plain text", status: 403, body: "  Beacons require a password\n", want: "Beacons require a password"},
		{name: "empty body", status: 502, body: "", want: "HTTP 502"},
		{name: "ok without a beacon id", status: 200, body: `{"ok":true}`, want: `{"ok":true}`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := Pair(pairingServer(t, tc.status, tc.body, nil), request)
			if got.OK || got.Error != tc.want || got.Status != tc.status {
				t.Fatalf("Pair = %+v, want error %q status %d", got, tc.want, tc.status)
			}
		})
	}
}

func TestPairReportsAnUnreachableServer(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	got := Pair("http://"+address, request)
	if got.OK || got.Error == "" || got.Status != 0 {
		t.Fatalf("Pair = %+v", got)
	}
}

func TestNormalizeCode(t *testing.T) {
	if got := NormalizeCode(" abcd-2345\t"); got != "ABCD2345" {
		t.Fatalf("NormalizeCode = %q", got)
	}
}

func TestAPairingLinkRoundTrips(t *testing.T) {
	target := Target{KannaURL: "https://kanna.example.com", Code: "ABCD2345"}
	link := BuildLink(target)
	if link != "kanna-beacon://pair?url=https%3A%2F%2Fkanna.example.com&code=ABCD2345" {
		t.Fatalf("BuildLink = %s", link)
	}
	if got, ok := ParseInput(link); !ok || got != target {
		t.Fatalf("ParseInput = %+v, %v", got, ok)
	}
}

func TestTheCLICommandKannaShowsIsAccepted(t *testing.T) {
	cases := map[string]Target{
		"kanna-beacon pair https://kanna.example.com/ ABCD2345":                            {KannaURL: "https://kanna.example.com", Code: "ABCD2345"},
		"  \"C:\\Tools\\kanna-beacon.exe\" pair http://192.168.1.5:5175 abcd2345\n":        {KannaURL: "http://192.168.1.5:5175", Code: "ABCD2345"},
		"kanna-beacon://pair?url=https://kanna.example.com&code=abcd-2345":                 {KannaURL: "https://kanna.example.com", Code: "ABCD2345"},
		"KANNA-BEACON://pair?url=https%3A%2F%2Fkanna.example.com&code=ABCD2345":            {KannaURL: "https://kanna.example.com", Code: "ABCD2345"},
		"kanna-beacon:///pair?url=https%3A%2F%2Fkanna.example.com%2Fbase%2F&code=ABCD2345": {KannaURL: "https://kanna.example.com/base", Code: "ABCD2345"},
	}
	for input, want := range cases {
		if got, ok := ParseInput(input); !ok || got != want {
			t.Errorf("ParseInput(%q) = %+v, %v; want %+v", input, got, ok, want)
		}
	}
}

func TestAnythingElseIsRefused(t *testing.T) {
	for _, input := range []string{
		"",
		"hello there",
		"kanna-beacon://pair?url=ftp%3A%2F%2Fx&code=ABCD2345",
		"kanna-beacon://pair?url=https%3A%2F%2Fx.example&code=SHORT",
		"kanna-beacon://pair?url=https%3A%2F%2Fx.example&code=ABCD1O00",
		"kanna-beacon://unpair?url=https%3A%2F%2Fx.example&code=ABCD2345",
		"kanna-beacon://pair?code=ABCD2345",
		"kanna-beacon pair https://x.example",
	} {
		if got, ok := ParseInput(input); ok {
			t.Errorf("ParseInput(%q) accepted %+v", input, got)
		}
	}
}
