import { create } from "zustand"
import type { BeaconMintResult } from "../../shared/beacon-config"

const NO_DRAFTS: Readonly<Record<string, string>> = {}
const NO_UPDATE_ERRORS: Readonly<Record<string, string>> = {}
const NO_ALIAS_ERRORS: Readonly<Record<string, string>> = {}
const NO_OPEN_EXPLANATIONS: Readonly<Record<string, true>> = {}

interface BeaconsSectionState {
  pairing: BeaconMintResult | null
  expandedId: string | null
  drafts: Readonly<Record<string, string>>
  updateErrors: Readonly<Record<string, string>>
  aliasErrors: Readonly<Record<string, string>>
  openExplanations: Readonly<Record<string, true>>
  setPairing(result: BeaconMintResult | null): void
  toggleExpanded(id: string): void
  setDraft(key: string, value: string): void
  clearDraft(key: string): void
  setUpdateError(beaconId: string, error: string | null): void
  beginAliasEdit(beaconId: string, current: string): void
  endAliasEdit(beaconId: string): void
  setAliasError(beaconId: string, error: string | null): void
  toggleExplanation(key: string): void
}

export function beaconDraftKey(beaconId: string, field: string): string {
  return `${beaconId}:${field}`
}

function without<T>(record: Readonly<Record<string, T>>, key: string, empty: Readonly<Record<string, T>>) {
  const rest = Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key))
  return Object.keys(rest).length > 0 ? rest : empty
}

export const useBeaconsSectionStore = create<BeaconsSectionState>()((set) => ({
  pairing: null,
  expandedId: null,
  drafts: NO_DRAFTS,
  updateErrors: NO_UPDATE_ERRORS,
  aliasErrors: NO_ALIAS_ERRORS,
  openExplanations: NO_OPEN_EXPLANATIONS,
  setPairing: (pairing) => set({ pairing }),
  toggleExpanded: (id) => set((state) => ({ expandedId: state.expandedId === id ? null : id })),
  setDraft: (key, value) => set((state) => ({ drafts: { ...state.drafts, [key]: value } })),
  clearDraft: (key) => set((state) => ({ drafts: without(state.drafts, key, NO_DRAFTS) })),
  setUpdateError: (beaconId, error) =>
    set((state) => {
      if (error !== null) return { updateErrors: { ...state.updateErrors, [beaconId]: error } }
      return { updateErrors: without(state.updateErrors, beaconId, NO_UPDATE_ERRORS) }
    }),
  beginAliasEdit: (beaconId, current) =>
    set((state) => ({ drafts: { ...state.drafts, [beaconDraftKey(beaconId, "alias")]: current } })),
  endAliasEdit: (beaconId) =>
    set((state) => ({
      drafts: without(state.drafts, beaconDraftKey(beaconId, "alias"), NO_DRAFTS),
      aliasErrors: without(state.aliasErrors, beaconId, NO_ALIAS_ERRORS),
    })),
  setAliasError: (beaconId, error) =>
    set((state) => {
      if (error !== null) return { aliasErrors: { ...state.aliasErrors, [beaconId]: error } }
      return { aliasErrors: without(state.aliasErrors, beaconId, NO_ALIAS_ERRORS) }
    }),
  toggleExplanation: (key) =>
    set((state) => ({
      openExplanations: key in state.openExplanations
        ? without(state.openExplanations, key, NO_OPEN_EXPLANATIONS)
        : { ...state.openExplanations, [key]: true },
    })),
}))
