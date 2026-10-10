import { describe, expect, test } from "bun:test"
import { BEACON_UPDATE_STATES } from "../../shared/beacon-protocol"
import { beaconUpdateLabel, beaconUpdateTone, isBeaconUpdateInFlight } from "./beaconUpdateStatus"

describe("beacon update status", () => {
  test("each progress state names the target version and reads as live work", () => {
    expect(beaconUpdateLabel({ state: "checking", version: "1.71.0" })).toBe("Checking 1.71.0…")
    expect(beaconUpdateLabel({ state: "downloading", version: "1.71.0" })).toBe("Downloading 1.71.0…")
    expect(beaconUpdateLabel({ state: "installing", version: "1.71.0" })).toBe("Installing 1.71.0…")
    expect(beaconUpdateLabel({ state: "restarting", version: "1.71.0" })).toBe("Restarting…")
    for (const state of ["checking", "downloading", "installing", "restarting"] as const) {
      expect(beaconUpdateTone({ state, version: "1.71.0" })).toBe("active")
      expect(isBeaconUpdateInFlight({ state, version: "1.71.0" })).toBe(true)
    }
  })

  test("a settled update is not in flight, and a failure carries its reason in the destructive tone", () => {
    expect(beaconUpdateLabel({ state: "current", version: "1.71.0" })).toBe("Up to date")
    expect(beaconUpdateTone({ state: "current", version: "1.71.0" })).toBe("muted")
    expect(beaconUpdateLabel({ state: "failed", version: "1.71.0", message: "checksum mismatch" })).toBe(
      "Update failed: checksum mismatch",
    )
    expect(beaconUpdateLabel({ state: "failed", version: "1.71.0" })).toBe("Update failed")
    expect(beaconUpdateTone({ state: "failed", version: "1.71.0" })).toBe("destructive")
    expect(isBeaconUpdateInFlight({ state: "current", version: "1.71.0" })).toBe(false)
    expect(isBeaconUpdateInFlight({ state: "failed", version: "1.71.0" })).toBe(false)
    expect(isBeaconUpdateInFlight(null)).toBe(false)
  })

  test("every protocol state has a label", () => {
    for (const state of BEACON_UPDATE_STATES) {
      expect(beaconUpdateLabel({ state, version: "1.71.0" }).length).toBeGreaterThan(0)
    }
  })
})
