import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { homedir, platform, userInfo } from "node:os"
import { dirname } from "node:path"
import { BEACON_LINK_SCHEME } from "../../shared/beacon-pair-link"
import { beaconOsFor } from "../host-os"
import { beaconHome, launcherPathFor } from "../paths"
import { desktopPaths } from "./desktop-os"
import { notifyRunningInstance } from "./single-instance.adapter"

async function main(): Promise<void> {
  const link = process.argv.slice(2).find((arg) => arg.toLowerCase().startsWith(`${BEACON_LINK_SCHEME}:`))
  if (link === undefined) return
  const os = beaconOsFor(platform())
  const paths = desktopPaths({
    os,
    beaconHome: beaconHome(os, process.env.KANNA_BEACON_HOME, homedir()),
    userName: userInfo().username,
  })
  if (await notifyRunningInstance(paths.instanceEndpoint, { kind: "link", url: link })) return
  mkdirSync(dirname(paths.pendingLinkFile), { recursive: true })
  writeFileSync(paths.pendingLinkFile, link, { mode: 0o600 })
  spawn(launcherPathFor(os, process.execPath), [], { detached: true, stdio: "ignore", windowsHide: false }).unref()
}

await main()
