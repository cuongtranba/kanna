import { create } from "zustand"
import type { BeaconMintResult } from "../../shared/beacon-config"

const NO_DRAFTS: Readonly<Record<string, string>> = {}
const NO_UPDATE_ERRORS: Readonly<Record<string, string>> = {}

interface BeaconsSectionState {
  pairing: BeaconMintResult | null
  expandedId: string | null
  drafts: Readonly<Record<string, string>>
  updateErrors: Readonly<Record<string, string>>
  setPairing(result: BeaconMintResult | null): void
  toggleExpanded(id: string): void
  setDraft(key: string, value: string): void
  clearDraft(key: string): void
  setUpdateError(beaconId: string, error: string | null): void
}

export function beaconDraftKey(beaconId: string, field: string): string {
  return `${beaconId}:${field}`
}

export const useBeaconsSectionStore = create<BeaconsSectionState>()((set) => ({
  pairing: null,
  expandedId: null,
  drafts: NO_DRAFTS,
  updateErrors: NO_UPDATE_ERRORS,
  setPairing: (pairing) => set({ pairing }),
  toggleExpanded: (id) => set((state) => ({ expandedId: state.expandedId === id ? null : id })),
  setDraft: (key, value) => set((state) => ({ drafts: { ...state.drafts, [key]: value } })),
  clearDraft: (key) =>
    set((state) => {
      const rest = Object.fromEntries(Object.entries(state.drafts).filter(([draftKey]) => draftKey !== key))
      return { drafts: Object.keys(rest).length > 0 ? rest : NO_DRAFTS }
    }),
  setUpdateError: (beaconId, error) =>
    set((state) => {
      if (error !== null) return { updateErrors: { ...state.updateErrors, [beaconId]: error } }
      const rest = Object.fromEntries(Object.entries(state.updateErrors).filter(([id]) => id !== beaconId))
      return { updateErrors: Object.keys(rest).length > 0 ? rest : NO_UPDATE_ERRORS }
    }),
}))
