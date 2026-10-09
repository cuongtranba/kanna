package utf8lossy_test

import (
	"testing"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/utf8lossy"
)

func TestStringReplacesEachMaximalSubpart(t *testing.T) {
	cases := []struct {
		name  string
		input []byte
		want  string
	}{
		{name: "ascii", input: []byte("hello"), want: "hello"},
		{name: "valid multibyte", input: []byte("héllo 😀"), want: "héllo 😀"},
		{name: "two lone bytes are two replacements", input: []byte{0xFF, 0xFE}, want: "\uFFFD\uFFFD"},
		{name: "a truncated sequence is one replacement", input: []byte{0xE2, 0x82, 'A'}, want: "\uFFFDA"},
		{name: "an overlong lead is rejected bytewise", input: []byte{0xC0, 0xAF}, want: "\uFFFD\uFFFD"},
		{name: "a surrogate encoding is rejected", input: []byte{0xED, 0xA0, 0x80}, want: "\uFFFD\uFFFD\uFFFD"},
		{name: "unfinished at the end", input: []byte{'a', 0xF0, 0x9F}, want: "a\uFFFD"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if got := utf8lossy.String(tc.input); got != tc.want {
				t.Fatalf("String(%x) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestDecoderCompletesACharacterSplitAcrossChunks(t *testing.T) {
	encoded := []byte("é😀")
	var decoder utf8lossy.Decoder
	got := ""
	for _, b := range encoded {
		got += decoder.Decode([]byte{b})
	}
	got += decoder.Flush()
	if got != "é😀" {
		t.Fatalf("streamed decode = %q", got)
	}
}

func TestTruncateUTF16CountsCodeUnits(t *testing.T) {
	if got := utf8lossy.TruncateUTF16("abcdef", 4); got != "abcd" {
		t.Fatalf("got %q", got)
	}
	if got := utf8lossy.TruncateUTF16("é😀x", 3); got != "é😀" {
		t.Fatalf("an astral character counts as two units, got %q", got)
	}
	if got := utf8lossy.TruncateUTF16("é😀x", 2); got != "é" {
		t.Fatalf("a pair straddling the limit is dropped whole, got %q", got)
	}
}
