import { describe, expect, test } from "bun:test"
import { DEFAULT_BEACON_SCOPE } from "./beacon-scope"
import type { BeaconConfig } from "./beacon-config"
import { buildBeaconStatusRows, isBeaconBehind, type BeaconLiveState } from "./beacon-status"

function config(id: string, overrides: Partial<BeaconConfig> = {}): BeaconConfig {
  return {
    id,
    label: `label-${id}`,
    publicKey: "key",
    os: "linux",
    scope: DEFAULT_BEACON_SCOPE,
    enabled: true,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
    ...overrides,
  }
}

function liveState(beaconId: string, lastSeenAt: number): BeaconLiveState {
  return { beaconId, online: true, lastSeenAt, beaconVersion: "1.2.3", canSelfUpdate: true, updateStatus: null }
}

describe("buildBeaconStatusRows", () => {
  test("joins live state by id and defaults a beacon with no live entry to offline", () => {
    const rows = buildBeaconStatusRows([config("a"), config("b", { enabled: false, os: "windows" })], [liveState("a", 500)])
    expect(rows).toEqual([
      {
        id: "a",
        label: "label-a",
        os: "linux",
        enabled: true,
        online: true,
        lastSeenAt: 500,
        beaconVersion: "1.2.3",
        canSelfUpdate: true,
        update: null,
      },
      {
        id: "b",
        label: "label-b",
        os: "windows",
        enabled: false,
        online: false,
        lastSeenAt: null,
        beaconVersion: null,
        canSelfUpdate: false,
        update: null,
      },
    ])
  })

  test("drops live entries whose beacon is no longer configured", () => {
    const rows = buildBeaconStatusRows([config("a")], [liveState("gone", 1), liveState("a", 2)])
    expect(rows.map((row) => row.id)).toEqual(["a"])
  })

  test("preserves config order regardless of live order", () => {
    const rows = buildBeaconStatusRows([config("z"), config("m"), config("a")], [liveState("a", 1), liveState("z", 2)])
    expect(rows.map((row) => row.id)).toEqual(["z", "m", "a"])
  })
})

describe("isBeaconBehind", () => {
  test("an equal version is not behind", () => {
    expect(isBeaconBehind("1.2.3", "1.2.3")).toBe(false)
  })

  test("an older version is behind, comparing numerically rather than lexically", () => {
    expect(isBeaconBehind("1.2.3", "1.2.4")).toBe(true)
    expect(isBeaconBehind("1.9.0", "1.10.0")).toBe(true)
  })

  test("a newer version is not behind", () => {
    expect(isBeaconBehind("1.3.0", "1.2.9")).toBe(false)
    expect(isBeaconBehind("2.0.0", "1.99.99")).toBe(false)
  })
})
