import path from "node:path"
import { BEACON_LINK_SCHEME } from "../../shared/beacon-pair-link"
import type { BeaconOs } from "../../shared/beacon-protocol"

export const BEACON_APP_NAME = "Kanna Beacon"
export const BEACON_APP_IDENTIFIER = "dev.kanna.beacon"
export const AUTOSTART_ENV = "KANNA_BEACON_AUTOSTART"

export interface DesktopPaths {
  home: string
  keyFile: string
  stateFile: string
  prefsFile: string
  activityFile: string
  pendingLinkFile: string
  logFile: string
  instanceEndpoint: string
}

export function desktopPaths(input: { os: BeaconOs; beaconHome: string; userName: string }): DesktopPaths {
  const join = input.os === "windows" ? path.win32.join : path.posix.join
  const at = (name: string) => join(input.beaconHome, name)
  const pipeName = `kanna-beacon-${input.userName.replace(/[^A-Za-z0-9_.-]/g, "-")}`
  return {
    home: input.beaconHome,
    keyFile: at("key.der"),
    stateFile: at("state.json"),
    prefsFile: at("desktop.json"),
    activityFile: at("activity.jsonl"),
    pendingLinkFile: at("pending-link.txt"),
    logFile: at("desktop.log"),
    instanceEndpoint: input.os === "windows" ? `\\\\.\\pipe\\${pipeName}` : at("app.sock"),
  }
}

const WINDOWS_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
const WINDOWS_SCHEME_KEY = `HKCU\\Software\\Classes\\${BEACON_LINK_SCHEME}`

export function windowsAutostartCommand(launcherPath: string, systemRoot: string): string {
  const system32 = path.win32.join(systemRoot, "System32")
  const conhost = path.win32.join(system32, "conhost.exe")
  return `"${conhost}" --headless cmd.exe /d /c "set ${AUTOSTART_ENV}=1&& "${launcherPath}""`
}

export function windowsRunKeyArgs(enabled: boolean, launcherPath: string, systemRoot: string): readonly string[] {
  if (!enabled) return ["delete", WINDOWS_RUN_KEY, "/v", BEACON_APP_NAME, "/f"]
  const command = windowsAutostartCommand(launcherPath, systemRoot)
  return ["add", WINDOWS_RUN_KEY, "/v", BEACON_APP_NAME, "/t", "REG_SZ", "/d", command, "/f"]
}

export function windowsUrlSchemeArgs(bunPath: string, helperPath: string): readonly (readonly string[])[] {
  return [
    ["add", WINDOWS_SCHEME_KEY, "/ve", "/t", "REG_SZ", "/d", `URL:${BEACON_APP_NAME}`, "/f"],
    ["add", WINDOWS_SCHEME_KEY, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"],
    [
      "add",
      `${WINDOWS_SCHEME_KEY}\\shell\\open\\command`,
      "/ve",
      "/t",
      "REG_SZ",
      "/d",
      `"${bunPath}" "${helperPath}" "%1"`,
      "/f",
    ],
  ]
}

export function macLaunchAgentPlist(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${BEACON_APP_IDENTIFIER}.login</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    "    <string>/usr/bin/open</string>",
    "    <string>-g</string>",
    "    <string>-b</string>",
    `    <string>${BEACON_APP_IDENTIFIER}</string>`,
    "    <string>--env</string>",
    `    <string>${AUTOSTART_ENV}=1</string>`,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n")
}

export function linuxAutostartEntry(launcherPath: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${BEACON_APP_NAME}`,
    `Exec=env ${AUTOSTART_ENV}=1 "${launcherPath}"`,
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n")
}

export function linuxUrlHandlerEntry(bunPath: string, helperPath: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${BEACON_APP_NAME}`,
    `Exec="${bunPath}" "${helperPath}" %u`,
    `MimeType=x-scheme-handler/${BEACON_LINK_SCHEME};`,
    "NoDisplay=true",
    "",
  ].join("\n")
}
