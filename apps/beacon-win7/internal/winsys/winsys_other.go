//go:build !windows

// Package winsys is Windows-only; elsewhere it reports that nothing applies,
// so the packages that import it still build and test on macOS and Linux.
package winsys

import "os"

// IsConsole is only meaningful on Windows, where it detects a console window
// opened by double-clicking the CLI.
func IsConsole(*os.File) bool { return false }
