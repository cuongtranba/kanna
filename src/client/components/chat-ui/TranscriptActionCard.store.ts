import { createScopedStore } from "../../lib/createScopedStore"

interface TranscriptActionCardState {
  busyId: string | null
  actionError: string | null
  setBusyId: (busyId: string | null) => void
  setActionError: (error: string | null) => void
}

export const TranscriptActionCardStore = createScopedStore<void, TranscriptActionCardState>(
  "TranscriptActionCard",
  () => (set) => ({
    busyId: null,
    actionError: null,
    setBusyId: (busyId) => set({ busyId }),
    setActionError: (actionError) => set({ actionError }),
  }),
)
