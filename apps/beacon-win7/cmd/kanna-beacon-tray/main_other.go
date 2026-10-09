//go:build !windows

// Command kanna-beacon-tray is the Windows 7 notification-area beacon. It
// only does anything on Windows; use kanna-beacon elsewhere.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "kanna-beacon-tray runs on Windows only. Use kanna-beacon run instead.")
	os.Exit(1)
}
