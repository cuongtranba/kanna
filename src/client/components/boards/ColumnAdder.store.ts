import { createScopedStore } from "../../lib/createScopedStore"

interface ColumnAdderState {
  draft: string
  setDraft(draft: string): void
  clear(): void
}

export const ColumnAdderStore = createScopedStore<void, ColumnAdderState>("ColumnAdder", () => (set) => ({
  draft: "",
  setDraft: (draft) => set({ draft }),
  clear: () => set({ draft: "" }),
}))
