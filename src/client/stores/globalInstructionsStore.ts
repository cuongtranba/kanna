import { create } from "zustand"

interface GlobalInstructionsState {
  draft: string
  persistedAtMount: string
  error: string | null

  setDraft: (draft: string) => void
  persistedChanged: (persisted: string) => void
  setError: (message: string | null) => void
}

export const useGlobalInstructionsStore = create<GlobalInstructionsState>()((set) => ({
  draft: "",
  persistedAtMount: "",
  error: null,

  setDraft: (draft) => set({ draft }),
  persistedChanged: (persisted) => set({ persistedAtMount: persisted, draft: persisted }),
  setError: (error) => set({ error }),
}))
