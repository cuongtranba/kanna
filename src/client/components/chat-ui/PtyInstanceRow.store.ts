import { createScopedStore } from "../../lib/createScopedStore"

interface PtyInstanceRowState {
  confirmKill: boolean
  setConfirmKill: (confirmKill: boolean) => void
  actionError: string | null
  setActionError: (actionError: string | null) => void
}

export const PtyInstanceRowStore = createScopedStore<void, PtyInstanceRowState>(
  "PtyInstanceRow",
  () => (set) => ({
    confirmKill: false,
    setConfirmKill: (confirmKill) => set({ confirmKill }),
    actionError: null,
    setActionError: (actionError) => set({ actionError }),
  }),
)
