import type { StateCreator } from "zustand"
import { createScopedStore } from "../../lib/createScopedStore"

export interface ExitPlanModeMessageState {
  expanded: boolean
  copied: boolean
  showEditInput: boolean
  editMessage: string

  setExpanded: (expanded: boolean) => void
  setCopied: (copied: boolean) => void
  setEditMessage: (editMessage: string) => void
  openEdit: () => void
  cancelEdit: () => void
}

export function createExitPlanModeMessageState(): StateCreator<ExitPlanModeMessageState> {
  return (set) => ({
    expanded: false,
    copied: false,
    showEditInput: false,
    editMessage: "",

    setExpanded: (expanded) => set({ expanded }),
    setCopied: (copied) => set({ copied }),
    setEditMessage: (editMessage) => set({ editMessage }),

    openEdit: () => set({ showEditInput: true }),

    cancelEdit: () =>
      set((state) =>
        state.showEditInput || state.editMessage !== ""
          ? { showEditInput: false, editMessage: "" }
          : state,
      ),
  })
}

export const ExitPlanModeMessageStore = createScopedStore<void, ExitPlanModeMessageState>(
  "ExitPlanModeMessage",
  createExitPlanModeMessageState,
)
