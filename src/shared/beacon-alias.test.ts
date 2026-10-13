import { describe, expect, test } from "bun:test"
import {
  beaconDisplayName,
  buildBeaconMentionIndex,
  resolveBeaconMentions,
  validateBeaconAliasFormat,
} from "./beacon-alias"
import type { BeaconConfig } from "./beacon-config"
import { DEFAULT_BEACON_SCOPE } from "./beacon-scope"

function config(id: string, label: string, alias?: string): BeaconConfig {
  return {
    id,
    label,
    ...(alias === undefined ? {} : { alias }),
    publicKey: "pk",
    os: "linux",
    scope: DEFAULT_BEACON_SCOPE,
    enabled: true,
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
  }
}

describe("beacon alias", () => {
  test("the display name prefers the alias over the hostname label", () => {
    expect(beaconDisplayName({ alias: "office-mac", label: "MacBook-Pro.local" })).toBe("office-mac")
    expect(beaconDisplayName({ alias: null, label: "MacBook-Pro.local" })).toBe("MacBook-Pro.local")
  })

  test("format accepts a slug handle and rejects uppercase, spaces and an overlong name", () => {
    expect(validateBeaconAliasFormat("office-mac_2")).toBeNull()
    expect(validateBeaconAliasFormat("Office")).not.toBeNull()
    expect(validateBeaconAliasFormat("my mac")).not.toBeNull()
    expect(validateBeaconAliasFormat("a".repeat(41))).not.toBeNull()
  })
})

describe("beacon mention index", () => {
  test("an alias claims its handle before another beacon's hostname slug", () => {
    const index = buildBeaconMentionIndex([config("a", "office-mac"), config("z", "other", "office-mac")])
    expect(index.beaconIdByHandle.get("office-mac")).toBe("z")
    expect(index.handleByBeaconId.get("a")).toBe("office-mac-2")
  })

  test("a beacon with no alias is addressed by a slug of its hostname", () => {
    const index = buildBeaconMentionIndex([config("a", "MacBook Pro.local")])
    expect(index.handleByBeaconId.get("a")).toBe("macbook-pro-local")
  })

  test("colliding hostname slugs are suffixed in id order regardless of input order", () => {
    const forward = buildBeaconMentionIndex([config("a", "Build Box"), config("b", "build-box")])
    const backward = buildBeaconMentionIndex([config("b", "build-box"), config("a", "Build Box")])
    expect([...forward.handleByBeaconId]).toEqual([["a", "build-box"], ["b", "build-box-2"]])
    expect([...backward.handleByBeaconId]).toEqual([...forward.handleByBeaconId])
  })

  test("a message mention resolves to the beacon and an unknown handle is reported unresolved", () => {
    const beacons = [config("a", "laptop", "office-mac")]
    const resolved = resolveBeaconMentions("run uname on @beacon/office-mac and @beacon/ghost", beacons)
    expect(resolved.beacons.map((beacon) => beacon.id)).toEqual(["a"])
    expect(resolved.unresolvedHandles).toEqual(["ghost"])
  })
})
