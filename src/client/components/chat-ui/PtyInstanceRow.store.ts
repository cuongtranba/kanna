import { createScopedStore } from "../../lib/createScopedStore"

interface PtyInstanceRowState {
  confirmKill: boolean
  setConfirmKill: (confirmKill: boolean) => void
}

export const PtyInstanceRowStore = createScopedStore<void, PtyInstanceRowState>(
  "PtyInstanceRow",
  () => (set) => ({
    confirmKill: false,
    setConfirmKill: (confirmKill) => set({ confirmKill }),
  }),
)
