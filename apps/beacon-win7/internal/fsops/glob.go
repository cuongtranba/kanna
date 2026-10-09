package fsops

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/bmatcuk/doublestar/v4"
)

const globChars = "*?[]{}"

func hasGlobChar(segment string) bool {
	return strings.ContainsAny(segment, globChars)
}

func splitGlob(pattern string) (base, relative string) {
	segments := strings.Split(pattern, "/")
	firstGlob := -1
	for index, segment := range segments {
		if hasGlobChar(segment) {
			firstGlob = index
			break
		}
	}
	if firstGlob == -1 {
		return pattern, ""
	}
	base = strings.Join(segments[:firstGlob], "/")
	if base == "" {
		base = "/"
	}
	return base, strings.Join(segments[firstGlob:], "/")
}

var errGlobFull = errors.New("glob: match limit reached")

// globScan reproduces Bun.Glob#scan with its defaults: a segment that does
// not start with "." never matches a dot entry, "**" never descends into a
// dot directory, symbolic links are matched but never followed, and
// directories are reported as well as files.
type globScan struct {
	root      string
	segments  []string
	limit     int
	matches   []string
	seen      map[string]struct{}
	truncated bool
}

func scanGlob(root, pattern string, limit int) ([]string, bool, error) {
	scan := &globScan{
		root:     root,
		segments: strings.Split(pattern, "/"),
		limit:    limit,
		matches:  make([]string, 0, 16),
		seen:     make(map[string]struct{}),
	}
	err := scan.walk("", 0)
	if errors.Is(err, errGlobFull) {
		return scan.matches, true, nil
	}
	if err != nil {
		return nil, false, err
	}
	return scan.matches, false, nil
}

func (s *globScan) emit(relative string) error {
	if relative == "" {
		return nil
	}
	if _, dup := s.seen[relative]; dup {
		return nil
	}
	if len(s.matches) >= s.limit {
		return errGlobFull
	}
	s.seen[relative] = struct{}{}
	s.matches = append(s.matches, filepath.Join(s.root, filepath.FromSlash(relative)))
	return nil
}

func joinRelative(prefix, name string) string {
	if prefix == "" {
		return name
	}
	return prefix + "/" + name
}

func (s *globScan) readDir(relative string) ([]fs.DirEntry, error) {
	entries, err := os.ReadDir(filepath.Join(s.root, filepath.FromSlash(relative)))
	if err != nil && (errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrPermission) || isNotDir(err)) {
		return nil, nil
	}
	return entries, err
}

func isRealDir(entry fs.DirEntry) bool {
	return entry.Type()&fs.ModeSymlink == 0 && entry.IsDir()
}

func (s *globScan) walk(relative string, index int) error {
	if index == len(s.segments) {
		return s.emit(relative)
	}
	segment := s.segments[index]
	last := index == len(s.segments)-1
	if segment == "**" {
		if err := s.walk(relative, index+1); err != nil {
			return err
		}
		entries, err := s.readDir(relative)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			child := joinRelative(relative, entry.Name())
			if last {
				if err := s.emit(child); err != nil {
					return err
				}
			}
			if isRealDir(entry) {
				if err := s.walk(child, index); err != nil {
					return err
				}
			}
		}
		return nil
	}
	entries, err := s.readDir(relative)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") && !strings.HasPrefix(segment, ".") {
			continue
		}
		matched, err := doublestar.Match(segment, name)
		if err != nil {
			return err
		}
		if !matched {
			continue
		}
		child := joinRelative(relative, name)
		if last {
			if err := s.emit(child); err != nil {
				return err
			}
			continue
		}
		if isRealDir(entry) {
			if err := s.walk(child, index+1); err != nil {
				return err
			}
		}
	}
	return nil
}
