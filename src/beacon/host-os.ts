import type { BeaconOs } from "../shared/beacon-protocol"

export function beaconOsFor(platform: string): BeaconOs {
  if (platform === "darwin") return "darwin"
  if (platform === "win32") return "windows"
  return "linux"
}
