//go:build windows

// Command kanna-beacon-tray is the Windows 7 beacon as a notification-area
// icon. Clicking a kanna-beacon://pair link in Kanna starts it with that link
// as its argument: it pairs, then hands over to the running tray (or becomes
// it). Built with -ldflags -H=windowsgui, so it never opens a console.
package main

import (
	_ "embed"
	"fmt"
	"os"
	"sync"
	"time"

	"fyne.io/systray"

	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/keystore"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/pairing"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/protocol"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/runner"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/state"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/transport"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/tray"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/version"
	"github.com/cuongtranba/kanna/apps/beacon-win7/internal/winsys"
)

var (
	//go:embed tray-idle.ico
	idleIcon []byte
	//go:embed tray-online.ico
	onlineIcon []byte
)

func fail(text string) {
	winsys.MessageBox(tray.AppName, text, winsys.MBOK|winsys.MBIconError)
}

func main() {
	home, err := state.Home()
	if err != nil {
		fail(err.Error())
		os.Exit(1)
	}
	instance, alreadyRunning, err := winsys.AcquireInstance(tray.MutexName)
	if err != nil {
		fail(err.Error())
		os.Exit(1)
	}
	defer instance.Release()

	if link := tray.LinkArgument(os.Args[1:]); link != "" {
		if !pairFromLink(home, link) {
			return
		}
		if alreadyRunning {
			winsys.Signal(tray.ReloadEvent)
			return
		}
	} else if alreadyRunning {
		winsys.MessageBox(tray.AppName, "Kanna Beacon is already running. Look for its icon in the notification area.", winsys.MBOK|winsys.MBIconInfo)
		return
	}

	app := &trayApp{home: home}
	app.registerLinkHandler()
	systray.Run(app.onReady, app.onExit)
}

func pairFromLink(home, link string) bool {
	target, ok := pairing.ParseInput(link)
	if !ok {
		fail("That isn't a valid pairing link. Copy it again from Kanna, Settings, Beacons.")
		return false
	}
	return pairWith(home, target)
}

// pairWith redeems the code, stores the pairing and tells the person. The key
// is reused when one exists, so re-pairing to another Kanna keeps this
// computer's identity.
func pairWith(home string, target pairing.Target) bool {
	keys, err := keystore.Open(state.KeyPath(home))
	if err != nil {
		fail("Pairing failed: " + err.Error())
		return false
	}
	hostname, _ := os.Hostname()
	result := pairing.Pair(target.KannaURL, pairing.Request{
		Code:      target.Code,
		PublicKey: keys.PublicKeySPKIBase64(),
		Label:     hostname,
		OS:        protocol.OSWindows,
	})
	if !result.OK {
		fail(tray.DescribePairingFailure(target.KannaURL, result.Error))
		return false
	}
	if err := state.Save(state.Path(home), state.State{KannaURL: target.KannaURL, BeaconID: result.BeaconID}); err != nil {
		fail("Pairing failed: " + err.Error())
		return false
	}
	winsys.MessageBox(tray.AppName, fmt.Sprintf("This computer is now paired with %s.\n\nKanna Beacon runs in the notification area.", tray.HostOf(target.KannaURL)), winsys.MBOK|winsys.MBIconInfo)
	return true
}

type trayApp struct {
	home string

	mu     sync.Mutex
	runner *runner.Runner
	paired *state.State
	label  func() string
	status *systray.MenuItem
	login  *systray.MenuItem
	unpair *systray.MenuItem
}

func executable() string {
	path, err := os.Executable()
	if err != nil {
		return ""
	}
	return path
}

func (a *trayApp) registerLinkHandler() {
	exe := executable()
	if exe == "" {
		return
	}
	_, _ = winsys.RegisterURLHandler(pairing.LinkScheme, tray.URLDescription, `"`+exe+`" "%1"`, tray.OwnerMarker)
}

func (a *trayApp) onReady() {
	systray.SetIcon(idleIcon)
	systray.SetTitle(tray.AppName)
	systray.SetTooltip(tray.AppName)
	a.status = systray.AddMenuItem(tray.NotPairedLabel, "")
	a.status.Disable()
	pairItem := systray.AddMenuItem(tray.PairFromClipboardLabel, tray.PairFromClipboardHint)
	systray.AddSeparator()
	atLogin, _ := winsys.RunAtLogin(tray.RunValueName)
	a.login = systray.AddMenuItemCheckbox("Start at login", "Start Kanna Beacon when you sign in to Windows", atLogin)
	folder := systray.AddMenuItem("Open beacon folder", a.home)
	a.unpair = systray.AddMenuItem("Unpair this machine", "Kanna loses access, and this computer forgets its key")
	systray.AddSeparator()
	quit := systray.AddMenuItem("Quit", "")

	a.start()
	go a.refreshEverySecond()
	go a.waitForReload()
	go func() {
		for {
			select {
			case <-pairItem.ClickedCh:
				a.pairFromClipboard()
			case <-a.login.ClickedCh:
				a.toggleLogin()
			case <-folder.ClickedCh:
				_ = os.MkdirAll(a.home, 0o777)
				if err := winsys.OpenFolder(a.home); err != nil {
					fail(err.Error())
				}
			case <-a.unpair.ClickedCh:
				a.confirmUnpair()
			case <-quit.ClickedCh:
				a.stop()
				systray.Quit()
				return
			}
		}
	}()
}

func (a *trayApp) onExit() {
	a.stop()
}

func (a *trayApp) toggleLogin() {
	enable := !a.login.Checked()
	exe := executable()
	if err := winsys.SetRunAtLogin(tray.RunValueName, `"`+exe+`"`, enable); err != nil {
		fail("Could not change Start at login: " + err.Error())
		return
	}
	if enable {
		a.login.Check()
	} else {
		a.login.Uncheck()
	}
}

func (a *trayApp) setLabel(label func() string) {
	a.mu.Lock()
	a.label = label
	a.mu.Unlock()
	a.status.SetTitle(label())
}

func (a *trayApp) refreshEverySecond() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for range ticker.C {
		a.mu.Lock()
		label := a.label
		a.mu.Unlock()
		if label != nil {
			a.status.SetTitle(label())
		}
	}
}

// start loads the saved pairing and, when there is one, runs the beacon.
func (a *trayApp) start() {
	paired := state.Load(state.Path(a.home))
	if paired == nil {
		a.mu.Lock()
		a.paired, a.runner = nil, nil
		a.mu.Unlock()
		systray.SetIcon(idleIcon)
		a.setLabel(func() string { return tray.NotPairedLabel })
		a.unpair.Disable()
		return
	}
	keys, err := keystore.Open(state.KeyPath(a.home))
	if err != nil {
		a.setLabel(func() string { return "Cannot read this computer's key: " + err.Error() })
		return
	}
	beacon := runner.New(runner.Deps{
		State:         *paired,
		OS:            protocol.OSWindows,
		BeaconVersion: version.Version,
		Signer:        keys,
		OpenTransport: func(url string) transport.Transport { return transport.Dial(url) },
	})
	a.mu.Lock()
	a.paired, a.runner = paired, beacon
	a.mu.Unlock()
	a.unpair.Enable()
	beacon.Subscribe(func(snapshot runner.Snapshot) {
		if !a.isCurrent(beacon) {
			return
		}
		status := snapshot.Status
		if tray.Online(status) {
			systray.SetIcon(onlineIcon)
		} else {
			systray.SetIcon(idleIcon)
		}
		systray.SetTooltip(tray.AppName + ": " + tray.StatusLabel(status, paired.KannaURL, time.Now()))
		a.setLabel(func() string { return tray.StatusLabel(status, paired.KannaURL, time.Now()) })
	})
	go beacon.Run()
}

func (a *trayApp) isCurrent(beacon *runner.Runner) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.runner == beacon
}

func (a *trayApp) stop() {
	a.mu.Lock()
	beacon := a.runner
	a.runner = nil
	a.mu.Unlock()
	if beacon != nil {
		beacon.Stop()
	}
}

func (a *trayApp) waitForReload() {
	event, err := winsys.CreateEvent(tray.ReloadEvent)
	if err != nil {
		return
	}
	for event.Wait() {
		a.stop()
		a.start()
	}
}

// pairFromClipboard pairs with a command or link someone copied, typically
// from a chat message sent by the person running Kanna on another computer.
func (a *trayApp) pairFromClipboard() {
	text, err := winsys.ClipboardText()
	if err != nil {
		fail("Could not read the copied text: " + err.Error())
		return
	}
	target, problem := tray.ClipboardTarget(text)
	if problem != "" {
		fail(problem)
		return
	}
	a.mu.Lock()
	paired, previousLabel := a.paired, a.label
	a.mu.Unlock()
	if paired != nil {
		question := fmt.Sprintf("This computer is paired with %s. Pair it with %s instead?", tray.HostOf(paired.KannaURL), tray.HostOf(target.KannaURL))
		if winsys.MessageBox(tray.AppName, question, winsys.MBYesNo|winsys.MBIconWarning) != winsys.IDYes {
			return
		}
	}
	a.setLabel(func() string { return "Pairing with " + tray.HostOf(target.KannaURL) })
	if !pairWith(a.home, target) {
		if previousLabel == nil {
			previousLabel = func() string { return tray.NotPairedLabel }
		}
		a.setLabel(previousLabel)
		return
	}
	a.stop()
	a.start()
}

func (a *trayApp) confirmUnpair() {
	a.mu.Lock()
	paired := a.paired
	beacon := a.runner
	a.mu.Unlock()
	if paired == nil {
		return
	}
	question := fmt.Sprintf("Unpair from %s? Kanna loses access right away, and this computer forgets its key.", tray.HostOf(paired.KannaURL))
	if winsys.MessageBox(tray.AppName, question, winsys.MBYesNo|winsys.MBIconWarning) != winsys.IDYes {
		return
	}
	a.unpair.Disable()
	a.setLabel(func() string { return "Unpairing" })
	informed := false
	wasRevoked := false
	if beacon != nil {
		wasRevoked = beacon.Snapshot().Status.Phase == runner.PhaseRevoked
		informed = beacon.Unpair(tray.UnpairTimeout)
	}
	a.stop()
	keyErr := keystore.Erase(state.KeyPath(a.home))
	stateErr := state.Clear(state.Path(a.home))
	a.start()
	if keyErr != nil || stateErr != nil {
		fail(fmt.Sprintf("Could not erase this computer's pairing: %v %v", keyErr, stateErr))
		return
	}
	if !informed && !wasRevoked {
		winsys.MessageBox(tray.AppName, fmt.Sprintf("This computer forgot its pairing, but %s could not be told. Remove it in Kanna, Settings, Beacons.", tray.HostOf(paired.KannaURL)), winsys.MBOK|winsys.MBIconWarning)
	}
}
