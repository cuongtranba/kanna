//go:build !windows

package fsops

import (
	"errors"
	"io/fs"
	"path/filepath"
	"syscall"
)

func realpath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(absolute)
}

func isNotDir(err error) bool {
	return errors.Is(err, syscall.ENOTDIR)
}

func isMissing(err error) bool {
	return errors.Is(err, fs.ErrNotExist) || isNotDir(err)
}
