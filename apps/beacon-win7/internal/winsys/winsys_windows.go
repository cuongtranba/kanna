//go:build windows

// Package winsys holds the Windows integration the tray needs: start at
// login, the kanna-beacon:// URL handler, single-instance and reload signals,
// message boxes, and opening a folder. It mirrors the Windows half of
// src/beacon/desktop/desktop-os.ts under names of its own, so it never fights
// the Electrobun desktop app over a registry value.
package winsys

import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	runKeyPath     = `Software\Microsoft\Windows\CurrentVersion\Run`
	classesKeyPath = `Software\Classes\`
)

// Message box flags.
const (
	MBOK          = windows.MB_OK
	MBYesNo       = windows.MB_YESNO
	MBIconInfo    = windows.MB_ICONINFORMATION
	MBIconWarning = windows.MB_ICONWARNING
	MBIconError   = windows.MB_ICONERROR
	IDYes         = 6
)

// IsConsole reports whether f is attached to a console window.
func IsConsole(f *os.File) bool {
	var mode uint32
	return windows.GetConsoleMode(windows.Handle(f.Fd()), &mode) == nil
}

// RunAtLogin reports whether the HKCU Run value name exists.
func RunAtLogin(name string) (bool, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.QUERY_VALUE)
	if err != nil {
		return false, err
	}
	defer key.Close()
	_, _, err = key.GetStringValue(name)
	if errors.Is(err, registry.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

// SetRunAtLogin writes or deletes the HKCU Run value name.
func SetRunAtLogin(name, command string, enabled bool) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	if enabled {
		return key.SetStringValue(name, command)
	}
	if err := key.DeleteValue(name); err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	return nil
}

func urlHandlerCommand(scheme string) (string, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, classesKeyPath+scheme+`\shell\open\command`, registry.QUERY_VALUE)
	if errors.Is(err, registry.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	defer key.Close()
	value, _, err := key.GetStringValue("")
	if errors.Is(err, registry.ErrNotExist) {
		return "", nil
	}
	return value, err
}

// RegisterURLHandler points scheme:// links at command, but only when the
// scheme is unclaimed or its current command contains ownerMarker; a handler
// another application registered is left alone. It reports whether it wrote.
func RegisterURLHandler(scheme, description, command, ownerMarker string) (bool, error) {
	current, err := urlHandlerCommand(scheme)
	if err != nil {
		return false, err
	}
	if current != "" && !strings.Contains(strings.ToLower(current), strings.ToLower(ownerMarker)) {
		return false, nil
	}
	root, _, err := registry.CreateKey(registry.CURRENT_USER, classesKeyPath+scheme, registry.SET_VALUE)
	if err != nil {
		return false, err
	}
	defer root.Close()
	if err := root.SetStringValue("", "URL:"+description); err != nil {
		return false, err
	}
	if err := root.SetStringValue("URL Protocol", ""); err != nil {
		return false, err
	}
	open, _, err := registry.CreateKey(registry.CURRENT_USER, classesKeyPath+scheme+`\shell\open\command`, registry.SET_VALUE)
	if err != nil {
		return false, err
	}
	defer open.Close()
	return true, open.SetStringValue("", command)
}

// Instance is the named mutex held by the running tray.
type Instance struct {
	handle windows.Handle
}

// AcquireInstance creates the named mutex. alreadyRunning is true when
// another process holds it; the returned Instance must still be released.
func AcquireInstance(name string) (instance *Instance, alreadyRunning bool, err error) {
	namePtr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return nil, false, err
	}
	handle, err := windows.CreateMutex(nil, false, namePtr)
	if handle == 0 {
		return nil, false, err
	}
	return &Instance{handle: handle}, errors.Is(err, windows.ERROR_ALREADY_EXISTS), nil
}

// Release closes the mutex handle.
func (i *Instance) Release() {
	if i != nil && i.handle != 0 {
		_ = windows.CloseHandle(i.handle)
		i.handle = 0
	}
}

// Event is a named auto-reset event the running tray waits on.
type Event struct {
	handle windows.Handle
}

// CreateEvent creates or opens the named event.
func CreateEvent(name string) (*Event, error) {
	namePtr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateEvent(nil, 0, 0, namePtr)
	if handle == 0 {
		return nil, err
	}
	return &Event{handle: handle}, nil
}

// Wait blocks until the event is signalled; it returns false if waiting failed.
func (e *Event) Wait() bool {
	result, err := windows.WaitForSingleObject(e.handle, windows.INFINITE)
	return err == nil && result == windows.WAIT_OBJECT_0
}

// Signal opens the named event and sets it. It reports whether a running
// tray was there to receive it.
func Signal(name string) bool {
	namePtr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return false
	}
	handle, err := windows.OpenEvent(windows.EVENT_MODIFY_STATE, false, namePtr)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(handle)
	return windows.SetEvent(handle) == nil
}

// MessageBox shows a modal message box and returns the button pressed.
func MessageBox(title, text string, flags uint32) int {
	titlePtr, _ := windows.UTF16PtrFromString(title)
	textPtr, _ := windows.UTF16PtrFromString(text)
	result, _ := windows.MessageBox(0, textPtr, titlePtr, flags|windows.MB_SETFOREGROUND)
	return int(result)
}

// OpenFolder opens path in Explorer.
func OpenFolder(path string) error {
	verb, _ := windows.UTF16PtrFromString("open")
	target, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, target, nil, nil, windows.SW_SHOWNORMAL)
}

const (
	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
)

// StartDetached starts exe with args as an independent process that outlives
// this one, and does not wait for it.
func StartDetached(exe string, args []string) error {
	command := exec.Command(exe, args...)
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detachedProcess | createNewProcessGroup}
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}
