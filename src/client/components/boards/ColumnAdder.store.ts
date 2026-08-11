import { create } from "zustand"

/**
 * The new-column name being typed.
 *
 * One adder exists per board pane, so a single draft is enough. It lives in a
 * store rather than component state because the field is rendered through the
 * kanban library's `renderColumnAdder` render prop, which remounts freely.
 */
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
