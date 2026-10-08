import { execFile } from "node:child_process"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { BeaconOs } from "../../shared/beacon-protocol"
import {
  BEACON_APP_IDENTIFIER,
  linuxAutostartEntry,
  linuxUrlHandlerEntry,
  macLaunchAgentPlist,
  windowsRunKeyArgs,
  windowsUrlSchemeArgs,
} from "./desktop-os"

const LINUX_LINK_ENTRY = "kanna-beacon-link.desktop"

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { windowsHide: true }, (error) => (error ? reject(error) : resolve()))
  })
}

async function writeOrRemove(path: string, content: string | null): Promise<void> {
  if (content === null) {
    await rm(path, { force: true })
    return
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

export function createLoginItem(input: { os: BeaconOs; launcherPath: string; homeDir: string; systemRoot: string }) {
  return {
    async set(enabled: boolean): Promise<void> {
      switch (input.os) {
        case "windows":
          await run("reg.exe", windowsRunKeyArgs(enabled, input.launcherPath, input.systemRoot)).catch((error: Error) => {
            if (enabled) throw error
          })
          return
        case "darwin":
          await writeOrRemove(
            join(input.homeDir, "Library", "LaunchAgents", `${BEACON_APP_IDENTIFIER}.login.plist`),
            enabled ? macLaunchAgentPlist() : null,
          )
          return
        case "linux":
          await writeOrRemove(
            join(input.homeDir, ".config", "autostart", "kanna-beacon.desktop"),
            enabled ? linuxAutostartEntry(input.launcherPath) : null,
          )
      }
    },
  }
}

export async function registerLinkHandler(input: {
  os: BeaconOs
  bunPath: string
  helperPath: string
  homeDir: string
}): Promise<void> {
  if (input.os === "windows") {
    for (const args of windowsUrlSchemeArgs(input.bunPath, input.helperPath)) await run("reg.exe", args)
    return
  }
  if (input.os === "linux") {
    await writeOrRemove(
      join(input.homeDir, ".local", "share", "applications", LINUX_LINK_ENTRY),
      linuxUrlHandlerEntry(input.bunPath, input.helperPath),
    )
    await run("xdg-mime", ["default", LINUX_LINK_ENTRY, "x-scheme-handler/kanna-beacon"])
  }
}
