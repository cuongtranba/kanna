import { createScopedStore } from "../lib/createScopedStore"

interface CopyButtonState {
  copied: boolean
  setCopied: (copied: boolean) => void
}

export const CopyButtonStore = createScopedStore<Record<string, never>, CopyButtonState>(
  "CopyButton",
  () => (set) => ({
    copied: false,
    setCopied: (copied) => set({ copied }),
  }),
)
