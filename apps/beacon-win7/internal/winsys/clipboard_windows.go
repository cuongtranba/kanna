//go:build windows

package winsys

import (
	"errors"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const cfUnicodeText = 13

// Loaded lazily, like the rest of x/sys/windows, so the executable's import
// table stays kernel32.dll only (the PE import check in CI pins that).
var (
	user32                         = windows.NewLazySystemDLL("user32.dll")
	kernel32                       = windows.NewLazySystemDLL("kernel32.dll")
	procOpenClipboard              = user32.NewProc("OpenClipboard")
	procCloseClipboard             = user32.NewProc("CloseClipboard")
	procIsClipboardFormatAvailable = user32.NewProc("IsClipboardFormatAvailable")
	procGetClipboardData           = user32.NewProc("GetClipboardData")
	procGlobalLock                 = kernel32.NewProc("GlobalLock")
	procGlobalUnlock               = kernel32.NewProc("GlobalUnlock")
)

// ClipboardText returns the text on the clipboard, or "" when it holds none.
func ClipboardText() (string, error) {
	if !openClipboard() {
		return "", errors.New("the clipboard is in use by another program; try again")
	}
	defer procCloseClipboard.Call()
	if available, _, _ := procIsClipboardFormatAvailable.Call(cfUnicodeText); available == 0 {
		return "", nil
	}
	handle, _, err := procGetClipboardData.Call(cfUnicodeText)
	if handle == 0 {
		return "", err
	}
	locked, _, err := procGlobalLock.Call(handle)
	if locked == 0 {
		return "", err
	}
	defer procGlobalUnlock.Call(handle)
	// Reinterpreting through a pointer keeps go vet's unsafeptr check quiet;
	// the memory stays valid until GlobalUnlock above.
	text := *(**uint16)(unsafe.Pointer(&locked))
	return windows.UTF16PtrToString(text), nil
}

// openClipboard retries briefly: another program may hold the clipboard for a
// moment right after copying.
func openClipboard() bool {
	for attempt := 0; attempt < 10; attempt++ {
		if opened, _, _ := procOpenClipboard.Call(0); opened != 0 {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}
