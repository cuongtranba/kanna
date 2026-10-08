import { afterEach, expect, test } from "bun:test"
import type { BeaconStatusRow } from "../../shared/beacon-status"
import { useBeaconsStore } from "./beaconsStore"

const ROW: BeaconStatusRow = {
  id: "b1",
  label: "Laptop",
  os: "darwin",
  enabled: true,
  online: true,
  lastSeenAt: 1_000,
  beaconVersion: "1.0.0",
}

afterEach(() => {
  useBeaconsStore.getState().setRows([])
})

test("setRows stores the live rows", () => {
  useBeaconsStore.getState().setRows([ROW])
  expect(useBeaconsStore.getState().rows).toEqual([ROW])
})

test("an empty snapshot keeps one stable reference so selectors do not loop", () => {
  useBeaconsStore.getState().setRows([])
  const first = useBeaconsStore.getState().rows
  useBeaconsStore.getState().setRows([ROW])
  useBeaconsStore.getState().setRows([])
  expect(useBeaconsStore.getState().rows).toBe(first)
})
