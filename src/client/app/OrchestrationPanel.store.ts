import { createScopedStore } from "../lib/createScopedStore"

interface OrchestrationPanelState {
  dialogOpen: boolean
  setDialogOpen: (open: boolean) => void
}

export const OrchestrationPanelStore = createScopedStore<void, OrchestrationPanelState>(
  "OrchestrationPanel",
  () => (set) => ({
    dialogOpen: false,
    setDialogOpen: (open) => set({ dialogOpen: open }),
  }),
)
