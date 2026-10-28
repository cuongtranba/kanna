import path from "node:path"
import type { BeaconOs } from "../shared/beacon-protocol"

const HOME_DIRECTORY_NAME = ".kanna-beacon"

function flavorFor(os: BeaconOs): typeof path.posix {
  return os === "windows" ? path.win32 : path.posix
}

export function beaconHome(os: BeaconOs, configured: string | undefined, homeDir: string): string {
  return configured ?? flavorFor(os).join(homeDir, HOME_DIRECTORY_NAME)
}

export function beaconFilePaths(os: BeaconOs, home: string): { keyFile: string; stateFile: string } {
  const join = flavorFor(os).join
  return { keyFile: join(home, "key.der"), stateFile: join(home, "state.json") }
}

export function launcherPathFor(os: BeaconOs, execPath: string): string {
  const flavor = flavorFor(os)
  return flavor.join(flavor.dirname(execPath), os === "windows" ? "launcher.exe" : "launcher")
}
