import { expect, test } from "bun:test"
import { isBeaconBehind } from "../shared/beacon-status"
import { APP_VERSION } from "../shared/branding"
import { BEACON_VERSION } from "./version"

test("a beacon built from this release is never reported as behind it", () => {
  expect(isBeaconBehind(BEACON_VERSION, APP_VERSION)).toBe(false)
})
