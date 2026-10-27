import { describe, expect, test } from "bun:test"
import { DEFAULT_BEACON_SCOPE } from "../shared/beacon-scope"
import type { BeaconConfig } from "../shared/beacon-config"
import {
  applyBeaconSetters,
  BeaconValidationException,
  normalizeBeacons,
  updateBeacon,
  validateBeaconLabel,
} from "./beacon-settings"

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

describe("beacon alias", () => {
  const stamp = "2026-10-13T00:00:00.000Z"
  const config = (id: string, label: string, alias?: string): BeaconConfig => ({
    id,
    label,
    ...(alias === undefined ? {} : { alias }),
    publicKey: "pk",
    os: "linux",
    scope: DEFAULT_BEACON_SCOPE,
    enabled: true,
    createdAt: stamp,
    updatedAt: stamp,
  })
  const first = config("b1", "laptop", "office-mac")
  const second = config("b2", "desktop")
  const current = [first, second]

  function rejectionCode(run: () => BeaconConfig): string | null {
    try {
      run()
    } catch (error) {
      if (!(error instanceof BeaconValidationException)) throw error
      return error.validationError.code
    }
    return null
  }

  test("an alias another beacon owns is rejected as INVALID_ALIAS", () => {
    expect(rejectionCode(() => updateBeacon(second, { alias: "office-mac" }, current))).toBe("INVALID_ALIAS")
  })

  test("an alias with uppercase or spaces is rejected as INVALID_ALIAS", () => {
    expect(rejectionCode(() => updateBeacon(second, { alias: "Office Mac" }, current))).toBe("INVALID_ALIAS")
  })

  test("a beacon may keep its own alias while editing something else", () => {
    expect(updateBeacon(first, { alias: "office-mac", enabled: false }, current)).toMatchObject({
      alias: "office-mac",
      enabled: false,
    })
  })

  test("a null alias patch clears the alias", () => {
    expect(updateBeacon(first, { alias: null }, current).alias).toBeUndefined()
  })

  test("an update that does not mention the alias leaves it alone", () => {
    expect(updateBeacon(first, { enabled: false }, current).alias).toBe("office-mac")
  })

  test("loading drops an invalid alias with a warning but keeps the beacon", () => {
    const warnings: string[] = []
    const [kept] = normalizeBeacons([{ ...valid, alias: "Not Valid" }], warnings)
    expect(kept?.id).toBe("b1")
    expect(kept?.alias).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  test("loading keeps the first of two beacons claiming the same alias", () => {
    const loaded = normalizeBeacons(
      [{ ...valid, alias: "shared" }, { ...valid, id: "b2", label: "other", alias: "shared" }],
      [],
    )
    expect(loaded.map((beacon) => [beacon.id, beacon.alias])).toEqual([["b1", "shared"], ["b2", undefined]])
  })
})

describe("applyBeaconSetters", () => {
  const beacon: BeaconConfig = {
    ...valid,
    os: "linux",
    scope: { ...DEFAULT_BEACON_SCOPE, trustedScriptHashes: ["old"] },
  }

  test("a patch carrying several ops applies every one instead of only the first", () => {
    const [next] = applyBeaconSetters([beacon], {
      setEnabled: { id: "b1", enabled: false },
      addTrustedScript: { id: "b1", hash: "new" },
      removeTrustedScript: { id: "b1", hash: "old" },
    })
    expect(next?.enabled).toBe(false)
    expect(next?.scope.trustedScriptHashes).toEqual(["new"])
  })

  test("adding a hash the beacon already trusts leaves the beacon untouched", () => {
    const [next] = applyBeaconSetters([beacon], { addTrustedScript: { id: "b1", hash: "old" } })
    expect(next).toBe(beacon)
  })

  test("an op naming another beacon leaves this one untouched", () => {
    const [next] = applyBeaconSetters([beacon], { setEnabled: { id: "other", enabled: false } })
    expect(next).toBe(beacon)
  })
})
