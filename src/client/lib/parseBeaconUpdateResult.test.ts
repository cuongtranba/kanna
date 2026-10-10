import { expect, test } from "bun:test"
import { parseBeaconUpdateResult } from "./parseBeaconUpdateResult"

test("an ok ack is accepted, a refusal keeps its message, and anything else becomes a generic error", () => {
  expect(parseBeaconUpdateResult({ ok: true })).toEqual({ ok: true })
  expect(parseBeaconUpdateResult({ ok: false, error: "beacon offline" })).toEqual({ ok: false, error: "beacon offline" })
  expect(parseBeaconUpdateResult({ ok: false })).toEqual({ ok: false, error: "Could not start the update" })
  expect(parseBeaconUpdateResult("nope")).toEqual({ ok: false, error: "Unexpected response from the server" })
})
