import { create } from "zustand"

interface ColumnAdderState {
  draft: string
  setDraft(draft: string): void
  clear(): void
}

export const useColumnAdderStore = create<ColumnAdderState>()((set) => ({
  draft: "",
  setDraft: (draft) => set({ draft }),
  clear: () => set({ draft: "" }),
}))
