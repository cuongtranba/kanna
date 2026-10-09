// Package fsops mirrors src/beacon/fs.adapter.ts: the read-only filesystem
// operations a beacon serves, each confined to the granted read roots by
// real path.
package fsops

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/dlclark/regexp2"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/utf8lossy"
)

const (
	binarySniffBytes  = 8192
	maxReadBytes      = 4 * 1024 * 1024
	fetchChunkBytes   = 256 * 1024
	maxGlobMatches    = 1000
	maxGrepMatches    = 500
	maxGrepFiles      = 20000
	maxGrepFileBytes  = 2 * 1024 * 1024
	maxGrepLineChars  = 400
	maxHashCacheItems = 8
)

// ScopeError is a request refused because its path is outside the roots.
type ScopeError struct {
	message string
}

func (e *ScopeError) Error() string { return e.message }

func denied(path string) error {
	return &ScopeError{message: "path is outside the permitted read roots: " + path}
}

// ReadResult answers a read request.
type ReadResult struct {
	Content   string `json:"content"`
	TotalSize int64  `json:"totalSize"`
	Truncated bool   `json:"truncated"`
	Binary    bool   `json:"binary"`
}

// StatResult answers a stat request.
type StatResult struct {
	Path        string  `json:"path"`
	Size        int64   `json:"size"`
	IsFile      bool    `json:"isFile"`
	IsDirectory bool    `json:"isDirectory"`
	MtimeMs     float64 `json:"mtimeMs"`
}

// GlobResult answers a glob request.
type GlobResult struct {
	Matches   []string `json:"matches"`
	Truncated bool     `json:"truncated"`
}

// GrepMatch is one matching line.
type GrepMatch struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

// GrepResult answers a grep request.
type GrepResult struct {
	Matches   []GrepMatch `json:"matches"`
	Truncated bool        `json:"truncated"`
}

// FetchResult answers one fetch chunk. SHA256 covers [0, NextFrom).
type FetchResult struct {
	Data      string `json:"data"`
	From      int64  `json:"from"`
	NextFrom  int64  `json:"nextFrom"`
	TotalSize int64  `json:"totalSize"`
	Done      bool   `json:"done"`
	SHA256    string `json:"sha256"`
}

type hashProgress struct {
	path     string
	hash     hash.Hash
	position int64
}

// FS serves filesystem requests against the read roots returned by roots,
// which is consulted on every call so a scope change applies immediately.
type FS struct {
	roots func() []string

	mu        sync.Mutex
	hashCache []hashProgress
}

// New returns an FS confined to roots.
func New(roots func() []string) *FS {
	return &FS{roots: roots}
}

func realRoots(roots []string) []string {
	resolved := make([]string, 0, len(roots))
	for _, root := range roots {
		if real, err := realpath(root); err == nil {
			resolved = append(resolved, real)
		}
	}
	return resolved
}

func nearestExistingRealpath(path string) (string, bool, error) {
	current, err := filepath.Abs(path)
	if err != nil {
		return "", false, err
	}
	for {
		real, err := realpath(current)
		if err == nil {
			return real, true, nil
		}
		if !isMissing(err) {
			return "", false, err
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", false, nil
		}
		current = parent
	}
}

func (f *FS) contained(path string) (string, error) {
	allowed := realRoots(f.roots())
	real, err := realpath(path)
	if err != nil {
		if !isMissing(err) {
			return "", err
		}
		ancestor, found, ancestorErr := nearestExistingRealpath(path)
		if ancestorErr != nil {
			return "", ancestorErr
		}
		if !found || !protocol.IsPathInsideRoots(ancestor, allowed) {
			return "", denied(path)
		}
		return "", fmt.Errorf("no such file or directory: %s", path)
	}
	if !protocol.IsPathInsideRoots(real, allowed) {
		return "", denied(path)
	}
	return real, nil
}

func isBinaryFile(path string, size int64) (bool, error) {
	sample, err := readWindow(path, 0, minInt64(binarySniffBytes, size))
	if err != nil {
		return false, err
	}
	for _, b := range sample {
		if b == 0 {
			return true, nil
		}
	}
	return false, nil
}

func readWindow(path string, offset, length int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return readAt(file, offset, length)
}

func readAt(file *os.File, offset, length int64) ([]byte, error) {
	if length <= 0 {
		return []byte{}, nil
	}
	buffer := make([]byte, length)
	n, err := file.ReadAt(buffer, offset)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return buffer[:n], nil
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func clampFloat(value float64) int64 {
	switch {
	case value != value:
		return 0
	case value > 1<<62:
		return 1 << 62
	case value < -(1 << 62):
		return -(1 << 62)
	default:
		return int64(value)
	}
}

// Read returns a byte window of a text file, or marks the file binary.
func (f *FS) Read(path string, offset, limit float64) (ReadResult, error) {
	real, err := f.contained(path)
	if err != nil {
		return ReadResult{}, err
	}
	info, err := os.Stat(real)
	if err != nil {
		return ReadResult{}, err
	}
	size := info.Size()
	binary, err := isBinaryFile(real, size)
	if err != nil {
		return ReadResult{}, err
	}
	if binary {
		return ReadResult{Content: "", TotalSize: size, Truncated: false, Binary: true}, nil
	}
	start := maxInt64(0, clampFloat(offset))
	length := maxInt64(0, minInt64(minInt64(clampFloat(limit), maxReadBytes), size-start))
	window, err := readWindow(real, start, length)
	if err != nil {
		return ReadResult{}, err
	}
	return ReadResult{
		Content:   utf8lossy.String(window),
		TotalSize: size,
		Truncated: start+int64(len(window)) < size,
		Binary:    false,
	}, nil
}

// Stat describes the real path behind path.
func (f *FS) Stat(path string) (StatResult, error) {
	real, err := f.contained(path)
	if err != nil {
		return StatResult{}, err
	}
	info, err := os.Stat(real)
	if err != nil {
		return StatResult{}, err
	}
	modified := info.ModTime()
	return StatResult{
		Path:        real,
		Size:        info.Size(),
		IsFile:      info.Mode().IsRegular(),
		IsDirectory: info.IsDir(),
		MtimeMs:     float64(modified.Unix())*1000 + float64(modified.Nanosecond())/1e6,
	}, nil
}

// Grep searches every regular file under root for lines matching pattern,
// interpreted as an ECMAScript regular expression.
func (f *FS) Grep(root, pattern string) (GrepResult, error) {
	real, err := f.contained(root)
	if err != nil {
		return GrepResult{}, err
	}
	matcher, err := regexp2.Compile(pattern, regexp2.ECMAScript)
	if err != nil {
		return GrepResult{}, err
	}
	files := make([]string, 0, 64)
	if err := collectFiles(real, &files); err != nil {
		return GrepResult{}, err
	}
	matches := make([]GrepMatch, 0, 16)
	for _, file := range files {
		if len(matches) >= maxGrepMatches {
			break
		}
		found, err := grepFile(file, matcher, maxGrepMatches-len(matches))
		if err != nil {
			return GrepResult{}, err
		}
		matches = append(matches, found...)
	}
	return GrepResult{
		Matches:   matches,
		Truncated: len(matches) >= maxGrepMatches || len(files) >= maxGrepFiles,
	}, nil
}

func collectFiles(root string, files *[]string) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if len(*files) >= maxGrepFiles {
			return nil
		}
		full := filepath.Join(root, entry.Name())
		kind := entry.Type()
		switch {
		case kind&(fs.ModeSymlink|fs.ModeIrregular) != 0:
			continue
		case kind.IsDir():
			if err := collectFiles(full, files); err != nil {
				return err
			}
		case kind.IsRegular():
			*files = append(*files, full)
		}
	}
	return nil
}

func grepFile(path string, matcher *regexp2.Regexp, budget int) ([]GrepMatch, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > maxGrepFileBytes {
		return nil, nil
	}
	binary, err := isBinaryFile(path, info.Size())
	if err != nil || binary {
		return nil, err
	}
	content, err := readWindow(path, 0, info.Size())
	if err != nil {
		return nil, err
	}
	found := make([]GrepMatch, 0, 4)
	lines := splitLines(utf8lossy.String(content))
	for index := 0; index < len(lines) && len(found) < budget; index++ {
		matched, err := matcher.MatchString(lines[index])
		if err != nil {
			return nil, err
		}
		if matched {
			found = append(found, GrepMatch{
				Path: path,
				Line: index + 1,
				Text: utf8lossy.TruncateUTF16(lines[index], maxGrepLineChars),
			})
		}
	}
	return found, nil
}

func splitLines(text string) []string {
	lines := make([]string, 0, 64)
	start := 0
	for index := 0; index < len(text); index++ {
		if text[index] == '\n' {
			lines = append(lines, text[start:index])
			start = index + 1
		}
	}
	return append(lines, text[start:])
}

// Glob expands pattern. Everything before the first segment holding a glob
// character is the base directory, which must lie inside the read roots.
func (f *FS) Glob(pattern string) (GlobResult, error) {
	base, relative := splitGlob(pattern)
	real, err := f.contained(base)
	if err != nil {
		return GlobResult{}, err
	}
	if relative == "" {
		return GlobResult{Matches: []string{real}, Truncated: false}, nil
	}
	matches, truncated, err := scanGlob(real, relative, maxGlobMatches)
	if err != nil {
		return GlobResult{}, err
	}
	return GlobResult{Matches: matches, Truncated: truncated}, nil
}

// FetchChunk returns up to 256 KiB from chunkFrom with a running sha256 of
// every byte before the chunk's end.
func (f *FS) FetchChunk(path string, from float64) (FetchResult, error) {
	real, err := f.contained(path)
	if err != nil {
		return FetchResult{}, err
	}
	file, err := os.Open(real)
	if err != nil {
		return FetchResult{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return FetchResult{}, err
	}
	size := info.Size()
	start := maxInt64(0, minInt64(clampFloat(from), size))
	progress, err := f.hashThrough(file, real, start)
	if err != nil {
		return FetchResult{}, err
	}
	chunk, err := readAt(file, start, minInt64(fetchChunkBytes, size-start))
	if err != nil {
		return FetchResult{}, err
	}
	progress.hash.Write(chunk)
	nextFrom := start + int64(len(chunk))
	progress.position = nextFrom
	digest := hex.EncodeToString(progress.hash.Sum(nil))
	f.remember(progress)
	return FetchResult{
		Data:      base64.StdEncoding.EncodeToString(chunk),
		From:      start,
		NextFrom:  nextFrom,
		TotalSize: size,
		Done:      nextFrom >= size,
		SHA256:    digest,
	}, nil
}

func (f *FS) takeCached(real string, position int64) (hashProgress, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for index, entry := range f.hashCache {
		if entry.path == real {
			f.hashCache = append(f.hashCache[:index], f.hashCache[index+1:]...)
			return entry, entry.position == position
		}
	}
	return hashProgress{}, false
}

func (f *FS) hashThrough(file *os.File, real string, from int64) (hashProgress, error) {
	if cached, ok := f.takeCached(real, from); ok {
		return cached, nil
	}
	progress := hashProgress{path: real, hash: sha256.New()}
	for progress.position < from {
		piece, err := readAt(file, progress.position, minInt64(fetchChunkBytes, from-progress.position))
		if err != nil {
			return hashProgress{}, err
		}
		if len(piece) == 0 {
			break
		}
		progress.hash.Write(piece)
		progress.position += int64(len(piece))
	}
	return progress, nil
}

func (f *FS) remember(progress hashProgress) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for index, entry := range f.hashCache {
		if entry.path == progress.path {
			f.hashCache = append(f.hashCache[:index], f.hashCache[index+1:]...)
			break
		}
	}
	f.hashCache = append(f.hashCache, progress)
	if len(f.hashCache) > maxHashCacheItems {
		f.hashCache = f.hashCache[1:]
	}
}

// Realpath resolves path the way Node's fs.realpath does on this platform.
func Realpath(path string) (string, error) {
	return realpath(path)
}
