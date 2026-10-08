import { describe, expect, test } from "bun:test"
import { DEFAULT_BEACON_SCOPE } from "../shared/beacon-scope"
import { normalizeBeacons, validateBeaconLabel } from "./beacon-settings"

const valid = {
  id: "b1",
  label: "laptop",
  publicKey: "pk",
  os: "linux",
  enabled: true,
  createdAt: "2026-10-08T00:00:00.000Z",
  updatedAt: "2026-10-08T00:00:00.000Z",
}

describe("normalizeBeacons", () => {
  test("absent input yields an empty list without warnings", () => {
    const warnings: string[] = []
    expect(normalizeBeacons(undefined, warnings)).toEqual([])
    expect(warnings).toEqual([])
  })

  test("a non-array warns and yields an empty list", () => {
    const warnings: string[] = []
    expect(normalizeBeacons({}, warnings)).toEqual([])
    expect(warnings).toContain("customBeacons must be an array")
  })

  test("a malformed entry is dropped while valid ones stay", () => {
    const warnings: string[] = []
    const result = normalizeBeacons([{ id: "x" }, valid], warnings)
    expect(result.map((b) => b.id)).toEqual(["b1"])
    expect(warnings).toHaveLength(1)
  })

  test("a missing scope is filled from the default and a partial scope keeps its set fields", () => {
    const [missing, partial] = normalizeBeacons(
      [valid, { ...valid, id: "b2", label: "other", scope: { exec: true, readRoots: ["/a"] } }],
      [],
    )
    expect(missing?.scope).toEqual(DEFAULT_BEACON_SCOPE)
    expect(partial?.scope).toEqual({ ...DEFAULT_BEACON_SCOPE, exec: true, readRoots: ["/a"] })
  })
})

describe("normalizeBeacons trusted script hashes", () => {
  test("non-string hash entries are dropped and an absent list defaults to empty", () => {
    const [withMixed, without] = normalizeBeacons(
      [
        { ...valid, scope: { trustedScriptHashes: ["h1", 7, null, "h2"] } },
        { ...valid, id: "b2", label: "other", scope: { exec: true } },
      ],
      [],
    )
    expect(withMixed?.scope.trustedScriptHashes).toEqual(["h1", "h2"])
    expect(without?.scope.trustedScriptHashes).toEqual([])
  })
})

describe("validateBeaconLabel", () => {
  const others = [{ id: "b1", label: "laptop" }]

  test("rejects an empty label", () => {
    expect(validateBeaconLabel("   ", others)).not.toBeNull()
  })

  test("rejects a label another beacon owns but allows keeping its own", () => {
    expect(validateBeaconLabel("laptop", others)).not.toBeNull()
    expect(validateBeaconLabel("laptop", others, "b1")).toBeNull()
  })

  test("accepts a unique label", () => {
    expect(validateBeaconLabel("desktop", others)).toBeNull()
  })
})
