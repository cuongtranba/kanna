package fsops_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/fsops"
)

type sandbox struct {
	base, root, outside string
}

func newSandbox(t *testing.T) sandbox {
	t.Helper()
	base, err := fsops.Realpath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := sandbox{base: base, root: filepath.Join(base, "root"), outside: filepath.Join(base, "outside")}
	for _, dir := range []string{s.root, s.outside} {
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func (s sandbox) fs() *fsops.FS {
	return fsops.New(func() []string { return []string{s.root} })
}

func write(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}
}

func symlinkOrSkip(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("cannot create symlinks here: %v", err)
	}
}

func isScopeError(err error) bool {
	var scope *fsops.ScopeError
	return errors.As(err, &scope)
}

func TestReadsAWindowedSliceWithTheTotalSize(t *testing.T) {
	s := newSandbox(t)
	write(t, filepath.Join(s.root, "a.txt"), []byte("0123456789"))
	got, err := s.fs().Read(filepath.Join(s.root, "a.txt"), 2, 4)
	if err != nil {
		t.Fatal(err)
	}
	want := fsops.ReadResult{Content: "2345", TotalSize: 10, Truncated: true, Binary: false}
	if got != want {
		t.Fatalf("Read = %+v, want %+v", got, want)
	}
	tail, err := s.fs().Read(filepath.Join(s.root, "a.txt"), 6, 100)
	if err != nil {
		t.Fatal(err)
	}
	if tail != (fsops.ReadResult{Content: "6789", TotalSize: 10}) {
		t.Fatalf("tail Read = %+v", tail)
	}
	past, err := s.fs().Read(filepath.Join(s.root, "a.txt"), 50, 10)
	if err != nil {
		t.Fatal(err)
	}
	if past != (fsops.ReadResult{Content: "", TotalSize: 10}) {
		t.Fatalf("read past the end = %+v", past)
	}
}

func TestReadReplacesInvalidUTF8(t *testing.T) {
	s := newSandbox(t)
	write(t, filepath.Join(s.root, "bad.txt"), []byte{'a', 0xFF, 0xFE, 'b'})
	got, err := s.fs().Read(filepath.Join(s.root, "bad.txt"), 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "a\uFFFD\uFFFDb" {
		t.Fatalf("content = %q", got.Content)
	}
}

func TestRefusesAPathOutsideEveryRoot(t *testing.T) {
	s := newSandbox(t)
	secret := filepath.Join(s.outside, "secret.txt")
	write(t, secret, []byte("nope"))
	_, err := s.fs().Read(secret, 0, 10)
	if !isScopeError(err) {
		t.Fatalf("err = %v, want a scope error", err)
	}
	if err.Error() != "path is outside the permitted read roots: "+secret {
		t.Fatalf("message = %q", err.Error())
	}
}

func TestRefusesASymlinkInsideARootThatPointsOutside(t *testing.T) {
	s := newSandbox(t)
	write(t, filepath.Join(s.outside, "secret.txt"), []byte("nope"))
	symlinkOrSkip(t, filepath.Join(s.outside, "secret.txt"), filepath.Join(s.root, "link.txt"))
	if _, err := s.fs().Read(filepath.Join(s.root, "link.txt"), 0, 10); !isScopeError(err) {
		t.Fatalf("err = %v, want a scope error", err)
	}
}

func TestAMissingPathIsReportedByWhereItWouldBe(t *testing.T) {
	s := newSandbox(t)
	ghostOutside := filepath.Join(s.outside, "ghost.txt")
	if _, err := s.fs().Stat(ghostOutside); !isScopeError(err) {
		t.Fatalf("missing path outside the roots: err = %v, want a scope error", err)
	}
	ghostInside := filepath.Join(s.root, "deeper", "ghost.txt")
	_, err := s.fs().Stat(ghostInside)
	if err == nil || isScopeError(err) {
		t.Fatalf("missing path inside the roots: err = %v", err)
	}
	if err.Error() != "no such file or directory: "+ghostInside {
		t.Fatalf("message = %q", err.Error())
	}
}

func TestARootThatDoesNotExistIsDroppedSilently(t *testing.T) {
	s := newSandbox(t)
	write(t, filepath.Join(s.root, "a.txt"), []byte("x"))
	fs := fsops.New(func() []string { return []string{filepath.Join(s.base, "gone"), s.root} })
	if _, err := fs.Stat(filepath.Join(s.root, "a.txt")); err != nil {
		t.Fatal(err)
	}
}

func TestMarksABinaryFileInsteadOfReturningItsBytes(t *testing.T) {
	s := newSandbox(t)
	write(t, filepath.Join(s.root, "blob.bin"), []byte{1, 2, 0, 3})
	got, err := s.fs().Read(filepath.Join(s.root, "blob.bin"), 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if got != (fsops.ReadResult{Content: "", TotalSize: 4, Truncated: false, Binary: true}) {
		t.Fatalf("Read = %+v", got)
	}
}

func TestStatDescribesTheRealPath(t *testing.T) {
	s := newSandbox(t)
	write(t, filepath.Join(s.root, "a.txt"), []byte("12345"))
	file, err := s.fs().Stat(filepath.Join(s.root, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if file.Path != filepath.Join(s.root, "a.txt") || file.Size != 5 || !file.IsFile || file.IsDirectory || file.MtimeMs <= 0 {
		t.Fatalf("Stat(file) = %+v", file)
	}
	dir, err := s.fs().Stat(s.root)
	if err != nil {
		t.Fatal(err)
	}
	if dir.IsFile || !dir.IsDirectory {
		t.Fatalf("Stat(dir) = %+v", dir)
	}
}

func TestGrepsMatchingLinesAndSkipsSymlinkedEscapes(t *testing.T) {
	s := newSandbox(t)
	write(t, filepath.Join(s.root, "a.txt"), []byte("alpha\nneedle here\n"))
	write(t, filepath.Join(s.outside, "b.txt"), []byte("needle outside\n"))
	symlinkOrSkip(t, s.outside, filepath.Join(s.root, "escape"))
	got, err := s.fs().Grep(s.root, "needle")
	if err != nil {
		t.Fatal(err)
	}
	want := []fsops.GrepMatch{{Path: filepath.Join(s.root, "a.txt"), Line: 2, Text: "needle here"}}
	if len(got.Matches) != 1 || got.Matches[0] != want[0] || got.Truncated {
		t.Fatalf("Grep = %+v, want %+v", got, want)
	}
}

func TestGrepUsesECMAScriptSyntaxAndSkipsBinaryFiles(t *testing.T) {
	s := newSandbox(t)
	write(t, filepath.Join(s.root, "src", "a.ts"), []byte("const fooBar = 1\r\nconst foo = 2\n"))
	write(t, filepath.Join(s.root, "blob.bin"), []byte("fooBar\x00"))
	got, err := s.fs().Grep(s.root, `foo(?=Bar)`)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Matches) != 1 {
		t.Fatalf("Grep = %+v", got)
	}
	if got.Matches[0].Text != "const fooBar = 1\r" || got.Matches[0].Line != 1 {
		t.Fatalf("match = %+v; lines split on \\n only and keep \\r", got.Matches[0])
	}
}

func TestGrepCapsLongLinesAndManyMatches(t *testing.T) {
	s := newSandbox(t)
	long := strings.Repeat("x", 1000)
	write(t, filepath.Join(s.root, "long.txt"), []byte(long))
	got, err := s.fs().Grep(s.root, "x")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Matches[0].Text) != 400 {
		t.Fatalf("line text is %d characters, want 400", len(got.Matches[0].Text))
	}
	write(t, filepath.Join(s.root, "many.txt"), []byte(strings.Repeat("hit\n", 600)))
	many, err := s.fs().Grep(s.root, "hit")
	if err != nil {
		t.Fatal(err)
	}
	if len(many.Matches) != 500 || !many.Truncated {
		t.Fatalf("got %d matches, truncated=%v; want 500, true", len(many.Matches), many.Truncated)
	}
}

func TestGrepReportsAnInvalidPatternAndAFileRoot(t *testing.T) {
	s := newSandbox(t)
	write(t, filepath.Join(s.root, "a.txt"), []byte("x"))
	if _, err := s.fs().Grep(s.root, "("); err == nil {
		t.Fatal("an invalid pattern must fail")
	}
	if _, err := s.fs().Grep(filepath.Join(s.root, "a.txt"), "x"); err == nil {
		t.Fatal("grep over a file root must fail like readdir does")
	}
}

func TestGlobMatchesFilesAndDirectoriesButNotDotEntries(t *testing.T) {
	s := newSandbox(t)
	for _, name := range []string{"a.go", "b.txt", ".hidden.go", "sub/c.go", "sub/deep/d.go", ".git/e.go"} {
		write(t, filepath.Join(s.root, filepath.FromSlash(name)), []byte("x"))
	}
	glob := func(pattern string) []string {
		t.Helper()
		got, err := s.fs().Glob(filepath.ToSlash(s.root) + "/" + pattern)
		if err != nil {
			t.Fatalf("Glob(%q): %v", pattern, err)
		}
		relative := make([]string, 0, len(got.Matches))
		for _, match := range got.Matches {
			rel, err := filepath.Rel(s.root, match)
			if err != nil {
				t.Fatal(err)
			}
			relative = append(relative, filepath.ToSlash(rel))
		}
		sort.Strings(relative)
		return relative
	}
	cases := map[string][]string{
		"*.go":      {"a.go"},
		"**/*.go":   {"a.go", "sub/c.go", "sub/deep/d.go"},
		".*.go":     {".hidden.go"},
		"*":         {"a.go", "b.txt", "sub"},
		"s?b/*":     {"sub/c.go", "sub/deep"},
		"{a,b}.*":   {"a.go", "b.txt"},
		"[ab].go":   {"a.go"},
		"[!a]*":     {"b.txt", "sub"},
		"**":        {"a.go", "b.txt", "sub", "sub/c.go", "sub/deep", "sub/deep/d.go"},
		"nothing*":  {},
		".git/*.go": {".git/e.go"},
	}
	for pattern, want := range cases {
		got := glob(pattern)
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("Glob(%q) = %v, want %v", pattern, got, want)
		}
	}
}

func TestGlobWithoutGlobCharactersReturnsTheContainedPath(t *testing.T) {
	s := newSandbox(t)
	write(t, filepath.Join(s.root, "a.txt"), []byte("x"))
	got, err := s.fs().Glob(filepath.Join(s.root, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Matches) != 1 || got.Matches[0] != filepath.Join(s.root, "a.txt") || got.Truncated {
		t.Fatalf("Glob = %+v", got)
	}
	if _, err := s.fs().Glob(filepath.ToSlash(s.outside) + "/*"); !isScopeError(err) {
		t.Fatalf("a glob based outside the roots: err = %v", err)
	}
}

func TestGlobStopsAtOneThousandMatches(t *testing.T) {
	s := newSandbox(t)
	for index := 0; index < 1001; index++ {
		write(t, filepath.Join(s.root, fmt.Sprintf("f%04d", index)), nil)
	}
	got, err := s.fs().Glob(filepath.ToSlash(s.root) + "/*")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Matches) != 1000 || !got.Truncated {
		t.Fatalf("got %d matches, truncated=%v", len(got.Matches), got.Truncated)
	}
}

func TestFetchesAFileInResumableChunksWithARunningSHA256(t *testing.T) {
	s := newSandbox(t)
	payload := bytes.Repeat([]byte{7}, 300*1024)
	path := filepath.Join(s.root, "big.dat")
	write(t, path, payload)
	fs := s.fs()
	first, err := fs.FetchChunk(path, 0)
	if err != nil {
		t.Fatal(err)
	}
	second, err := fs.FetchChunk(path, 256*1024)
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := s.fs().FetchChunk(path, 256*1024)
	if err != nil {
		t.Fatal(err)
	}
	if first.From != 0 || first.NextFrom != 256*1024 || first.Done || first.TotalSize != int64(len(payload)) {
		t.Fatalf("first chunk = %+v", first)
	}
	firstSum := sha256.Sum256(payload[:256*1024])
	if first.SHA256 != hex.EncodeToString(firstSum[:]) {
		t.Fatal("the first chunk's sha256 must cover [0, nextFrom)")
	}
	if second.NextFrom != int64(len(payload)) || !second.Done {
		t.Fatalf("second chunk = %+v", second)
	}
	if resumed != second {
		t.Fatal("a fresh instance must rehash to the same answer")
	}
	whole := sha256.Sum256(payload)
	if second.SHA256 != hex.EncodeToString(whole[:]) {
		t.Fatal("the final sha256 must cover the whole file")
	}
}

func TestFetchingAnEmptyFileIsDoneAtOnce(t *testing.T) {
	s := newSandbox(t)
	path := filepath.Join(s.root, "empty")
	write(t, path, nil)
	got, err := s.fs().FetchChunk(path, 10)
	if err != nil {
		t.Fatal(err)
	}
	empty := sha256.Sum256(nil)
	want := fsops.FetchResult{Data: "", From: 0, NextFrom: 0, TotalSize: 0, Done: true, SHA256: hex.EncodeToString(empty[:])}
	if got != want {
		t.Fatalf("FetchChunk = %+v, want %+v", got, want)
	}
}
