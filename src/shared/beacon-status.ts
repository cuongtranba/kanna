import type { BeaconOs } from "./beacon-protocol"
import type { BeaconConfig } from "./beacon-config"

export interface BeaconStatusRow {
  id: string
  label: string
  os: BeaconOs
  enabled: boolean
  online: boolean
  lastSeenAt: number | null
  beaconVersion: string | null
}

export interface BeaconsSnapshot {
  beacons: BeaconStatusRow[]
}

export interface BeaconLiveState {
  beaconId: string
  online: boolean
  lastSeenAt: number
  beaconVersion: string
}

export function buildBeaconStatusRows(
  configs: readonly BeaconConfig[],
  live: readonly BeaconLiveState[],
): BeaconStatusRow[] {
  const liveById = new Map<string, BeaconLiveState>()
  for (const entry of live) liveById.set(entry.beaconId, entry)
  return configs.map((config) => {
    const state = liveById.get(config.id)
    return {
      id: config.id,
      label: config.label,
      os: config.os,
      enabled: config.enabled,
      online: state?.online ?? false,
      lastSeenAt: state?.lastSeenAt ?? null,
      beaconVersion: state?.beaconVersion ?? null,
    }
  })
}

function versionParts(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10))
}

export function isBeaconBehind(beaconVersion: string, serverVersion: string): boolean {
  if (beaconVersion === serverVersion) return false
  const beacon = versionParts(beaconVersion)
  const server = versionParts(serverVersion)
  const length = Math.max(beacon.length, server.length)
  for (let index = 0; index < length; index += 1) {
    const left = beacon[index] ?? 0
    const right = server[index] ?? 0
    if (Number.isNaN(left) || Number.isNaN(right)) return beaconVersion < serverVersion
    if (left !== right) return left < right
  }
  return false
}
