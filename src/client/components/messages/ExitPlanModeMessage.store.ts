import { createScopedStore } from "../../lib/createScopedStore"

interface ExitPlanModeMessageState {
  expanded: boolean
  copied: boolean
  showEditInput: boolean
  editMessage: string
  setExpanded: (expanded: boolean) => void
  setCopied: (copied: boolean) => void
  setShowEditInput: (showEditInput: boolean) => void
  setEditMessage: (editMessage: string) => void
}

export const ExitPlanModeMessageStore = createScopedStore<void, ExitPlanModeMessageState>(
  "ExitPlanModeMessage",
  () => (set) => ({
    expanded: false,
    copied: false,
    showEditInput: false,
    editMessage: "",
    setExpanded: (expanded) => set({ expanded }),
    setCopied: (copied) => set({ copied }),
    setShowEditInput: (showEditInput) => set({ showEditInput }),
    setEditMessage: (editMessage) => set({ editMessage }),
  }),
)
