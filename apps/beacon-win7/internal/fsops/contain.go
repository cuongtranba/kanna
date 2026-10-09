package fsops

import (
	"path/filepath"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
)

// Contain returns the real path of path when it lies inside the read roots,
// the same check every read-only operation makes.
func (f *FS) Contain(path string) (string, error) {
	return f.contained(path)
}

func deniedWrite(path string) error {
	return &ScopeError{message: "path is outside the permitted write roots: " + path}
}

// ResolveForWrite returns where path would land, with every symlink in its
// nearest existing ancestor resolved, and refuses it unless that location lies
// inside the write roots. The file itself need not exist.
func ResolveForWrite(path string, writeRoots []string) (string, error) {
	allowed := realRoots(writeRoots)
	current, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	var missing []string
	for {
		real, err := realpath(current)
		if err == nil {
			if !protocol.IsPathInsideRoots(real, allowed) {
				return "", deniedWrite(path)
			}
			for index := len(missing) - 1; index >= 0; index-- {
				real = filepath.Join(real, missing[index])
			}
			return real, nil
		}
		if !isMissing(err) {
			return "", err
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", deniedWrite(path)
		}
		missing = append(missing, filepath.Base(current))
		current = parent
	}
}
