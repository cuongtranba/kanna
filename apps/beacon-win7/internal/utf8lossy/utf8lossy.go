// Package utf8lossy decodes bytes as UTF-8 the way Buffer#toString("utf8")
// and TextDecoder do: each maximal invalid subpart becomes one U+FFFD, per
// the WHATWG Encoding Standard. strings.ToValidUTF8 differs: it collapses a
// whole run of invalid bytes into a single replacement.
package utf8lossy

import (
	"strings"
	"unicode/utf8"
)

// Decoder is a streaming WHATWG UTF-8 decoder. A sequence split across two
// Decode calls is completed by the second call. The zero value is ready.
type Decoder struct {
	needed    int
	seen      int
	codePoint rune
	lower     byte
	upper     byte
}

func (d *Decoder) reset() {
	d.needed, d.seen, d.codePoint = 0, 0, 0
	d.lower, d.upper = 0x80, 0xBF
}

// Decode consumes p and returns every character it completes.
func (d *Decoder) Decode(p []byte) string {
	if d.lower == 0 {
		d.reset()
	}
	var out strings.Builder
	out.Grow(len(p))
	for index := 0; index < len(p); index++ {
		b := p[index]
		if d.needed == 0 {
			switch {
			case b <= 0x7F:
				out.WriteByte(b)
			case b >= 0xC2 && b <= 0xDF:
				d.needed, d.codePoint = 1, rune(b&0x1F)
			case b >= 0xE0 && b <= 0xEF:
				if b == 0xE0 {
					d.lower = 0xA0
				} else if b == 0xED {
					d.upper = 0x9F
				}
				d.needed, d.codePoint = 2, rune(b&0x0F)
			case b >= 0xF0 && b <= 0xF4:
				if b == 0xF0 {
					d.lower = 0x90
				} else if b == 0xF4 {
					d.upper = 0x8F
				}
				d.needed, d.codePoint = 3, rune(b&0x07)
			default:
				out.WriteRune(utf8.RuneError)
			}
			continue
		}
		if b < d.lower || b > d.upper {
			d.reset()
			out.WriteRune(utf8.RuneError)
			index--
			continue
		}
		d.lower, d.upper = 0x80, 0xBF
		d.codePoint = d.codePoint<<6 | rune(b&0x3F)
		d.seen++
		if d.seen == d.needed {
			out.WriteRune(d.codePoint)
			d.reset()
		}
	}
	return out.String()
}

// Flush ends the stream: an unfinished sequence becomes one U+FFFD.
func (d *Decoder) Flush() string {
	pending := d.needed != 0
	d.reset()
	if pending {
		return string(utf8.RuneError)
	}
	return ""
}

// String decodes a complete byte slice.
func String(p []byte) string {
	var decoder Decoder
	return decoder.Decode(p) + decoder.Flush()
}

// TruncateUTF16 returns the longest prefix of s that is at most limit UTF-16
// code units long, matching String.prototype.slice(0, limit) except that a
// surrogate pair straddling the limit is dropped whole rather than split.
func TruncateUTF16(s string, limit int) string {
	units := 0
	for index, r := range s {
		width := 1
		if r >= 0x10000 {
			width = 2
		}
		if units+width > limit {
			return s[:index]
		}
		units += width
	}
	return s
}
