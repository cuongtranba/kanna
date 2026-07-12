import { createScopedStore } from "../../lib/createScopedStore"

interface CopyStateState {
  copied: boolean
  setCopied: (copied: boolean) => void
}

export const CopyStateStore = createScopedStore<void, CopyStateState>(
  "CopyState",
  () => (set) => ({
    copied: false,
    setCopied: (copied) => set({ copied }),
  }),
)
