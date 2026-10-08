import { describe, expect, test } from "bun:test"
import {
  desktopPaths,
  linuxAutostartEntry,
  linuxUrlHandlerEntry,
  macLaunchAgentPlist,
  windowsRunKeyArgs,
  windowsUrlSchemeArgs,
} from "./desktop-os"

describe("desktop paths", () => {
  test("Windows keeps state beside the CLI and talks over a per-user named pipe", () => {
    const paths = desktopPaths({ os: "windows", beaconHome: "C:\\Users\\Admin\\.kanna-beacon", userName: "Admin" })
    expect(paths.keyFile).toBe("C:\\Users\\Admin\\.kanna-beacon\\key.der")
    expect(paths.stateFile).toBe("C:\\Users\\Admin\\.kanna-beacon\\state.json")
    expect(paths.activityFile).toBe("C:\\Users\\Admin\\.kanna-beacon\\activity.jsonl")
    expect(paths.instanceEndpoint).toBe("\\\\.\\pipe\\kanna-beacon-Admin")
  })

  test("a user name that is not pipe-safe is reduced to safe characters", () => {
    expect(desktopPaths({ os: "windows", beaconHome: "C:\\h", userName: "Nguyễn Văn A" }).instanceEndpoint).toBe(
      "\\\\.\\pipe\\kanna-beacon-Nguy-n-V-n-A",
    )
  })

  test("macOS and Linux use a socket file in the beacon home", () => {
    const paths = desktopPaths({ os: "darwin", beaconHome: "/Users/me/.kanna-beacon", userName: "me" })
    expect(paths.instanceEndpoint).toBe("/Users/me/.kanna-beacon/app.sock")
    expect(paths.prefsFile).toBe("/Users/me/.kanna-beacon/desktop.json")
    expect(paths.pendingLinkFile).toBe("/Users/me/.kanna-beacon/pending-link.txt")
  })
})

describe("launch at login", () => {
  test("Windows adds and removes one Run value that starts the launcher marked as an autostart, with no console", () => {
    expect(windowsRunKeyArgs(true, "C:\\Apps\\Kanna Beacon\\bin\\launcher.exe", "C:\\Windows")).toEqual([
      "add",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
      "/v",
      "Kanna Beacon",
      "/t",
      "REG_SZ",
      "/d",
      '"C:\\Windows\\System32\\conhost.exe" --headless cmd.exe /d /c "set KANNA_BEACON_AUTOSTART=1&& "C:\\Apps\\Kanna Beacon\\bin\\launcher.exe""',
      "/f",
    ])
    expect(windowsRunKeyArgs(false, "ignored", "C:\\Windows")).toEqual([
      "delete",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
      "/v",
      "Kanna Beacon",
      "/f",
    ])
  })

  test("macOS opens the app by bundle identifier, so a moved app still starts", () => {
    const plist = macLaunchAgentPlist()
    expect(plist).toContain("<string>/usr/bin/open</string>")
    expect(plist).toContain("<string>dev.kanna.beacon</string>")
    expect(plist).toContain("<string>KANNA_BEACON_AUTOSTART=1</string>")
    expect(plist).toContain("<key>RunAtLoad</key>")
  })

  test("Linux autostarts the launcher from an XDG entry", () => {
    expect(linuxAutostartEntry("/opt/kanna-beacon/bin/launcher")).toContain(
      'Exec=env KANNA_BEACON_AUTOSTART=1 "/opt/kanna-beacon/bin/launcher"',
    )
  })
})

describe("pairing link handler", () => {
  test("Windows registers kanna-beacon: to run the helper with the link", () => {
    expect(windowsUrlSchemeArgs("C:\\A\\bin\\bun.exe", "C:\\A\\Resources\\app\\bun\\open-link.js")).toEqual([
      ["add", "HKCU\\Software\\Classes\\kanna-beacon", "/ve", "/t", "REG_SZ", "/d", "URL:Kanna Beacon", "/f"],
      ["add", "HKCU\\Software\\Classes\\kanna-beacon", "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"],
      [
        "add",
        "HKCU\\Software\\Classes\\kanna-beacon\\shell\\open\\command",
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        '"C:\\A\\bin\\bun.exe" "C:\\A\\Resources\\app\\bun\\open-link.js" "%1"',
        "/f",
      ],
    ])
  })

  test("Linux declares the scheme on a hidden desktop entry", () => {
    const entry = linuxUrlHandlerEntry("/opt/b/bin/bun", "/opt/b/Resources/app/bun/open-link.js")
    expect(entry).toContain("MimeType=x-scheme-handler/kanna-beacon;")
    expect(entry).toContain('Exec="/opt/b/bin/bun" "/opt/b/Resources/app/bun/open-link.js" %u')
    expect(entry).toContain("NoDisplay=true")
  })
})
