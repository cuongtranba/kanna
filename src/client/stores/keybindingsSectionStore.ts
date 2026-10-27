import { create } from "zustand"

const EMPTY_DRAFTS: Readonly<Record<string, string>> = {}

interface KeybindingsSectionState {
  drafts: Readonly<Record<string, string>>
  error: string | null

  setDrafts: (drafts: Readonly<Record<string, string>>) => void
  setDraft: (action: string, value: string) => void
  setError: (message: string | null) => void
}

export const useKeybindingsSectionStore = create<KeybindingsSectionState>()((set) => ({
  drafts: EMPTY_DRAFTS,
  error: null,

  setDrafts: (drafts) => set({ drafts }),
  setDraft: (action, value) =>
    set((state) => (state.drafts[action] === value ? state : { drafts: { ...state.drafts, [action]: value } })),
  setError: (error) => set({ error }),
}))
