//go:build windows

package fsops

import (
	"errors"
	"io/fs"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// volumeNameDOS asks GetFinalPathNameByHandleW for a drive-letter path
// (VOLUME_NAME_DOS | FILE_NAME_NORMALIZED, both zero), as libuv does.
const volumeNameDOS = 0

// realpath matches libuv's uv_fs_realpath on Windows: open the path, ask the
// kernel for its final DOS path, and strip the \\?\ prefix (\\?\UNC\ becomes
// \\). The result carries the on-disk spelling, as Node's realpath does.
func realpath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	name, err := windows.UTF16PtrFromString(absolute)
	if err != nil {
		return "", err
	}
	handle, err := windows.CreateFile(
		name,
		0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS,
		0,
	)
	if err != nil {
		return "", &fs.PathError{Op: "realpath", Path: path, Err: err}
	}
	defer windows.CloseHandle(handle)
	buffer := make([]uint16, windows.MAX_LONG_PATH)
	for {
		n, err := windows.GetFinalPathNameByHandle(handle, &buffer[0], uint32(len(buffer)), volumeNameDOS)
		if err != nil {
			return "", &fs.PathError{Op: "realpath", Path: path, Err: err}
		}
		if int(n) < len(buffer) {
			return stripExtendedPrefix(windows.UTF16ToString(buffer[:n])), nil
		}
		buffer = make([]uint16, n+1)
	}
}

func stripExtendedPrefix(path string) string {
	switch {
	case strings.HasPrefix(path, `\\?\UNC\`):
		return `\\` + path[len(`\\?\UNC\`):]
	case strings.HasPrefix(path, `\\?\`):
		return path[len(`\\?\`):]
	default:
		return path
	}
}

func isNotDir(err error) bool {
	return errors.Is(err, windows.ERROR_DIRECTORY)
}

// isMissing follows libuv's error mapping: every Windows code that libuv
// reports as ENOENT or ENOTDIR counts as missing.
func isMissing(err error) bool {
	return errors.Is(err, fs.ErrNotExist) ||
		errors.Is(err, windows.ERROR_INVALID_NAME) ||
		errors.Is(err, windows.ERROR_BAD_PATHNAME) ||
		errors.Is(err, windows.ERROR_INVALID_DRIVE) ||
		errors.Is(err, windows.ERROR_BAD_NETPATH) ||
		isNotDir(err)
}
