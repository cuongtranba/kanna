import { create } from "zustand"
import type { BeaconStatusRow } from "../../shared/beacon-status"

const EMPTY: readonly BeaconStatusRow[] = []

interface BeaconsState {
  rows: readonly BeaconStatusRow[]
  setRows(rows: readonly BeaconStatusRow[]): void
}

export const useBeaconsStore = create<BeaconsState>()((set) => ({
  rows: EMPTY,
  setRows: (rows) => set({ rows: rows.length > 0 ? rows : EMPTY }),
}))

export const selectBeaconRows = (state: BeaconsState): readonly BeaconStatusRow[] => state.rows

export const selectBeaconById = (beaconId: string) => (state: BeaconsState): BeaconStatusRow | null =>
  state.rows.find((row) => row.id === beaconId) ?? null
