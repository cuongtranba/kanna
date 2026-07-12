import { createScopedStore } from "../../../lib/createScopedStore"

interface MessageCodeBlockState {
  copied: boolean
  setCopied: (copied: boolean) => void
}

export const MessageCodeBlockStore = createScopedStore<void, MessageCodeBlockState>(
  "MessageCodeBlock",
  () => (set) => ({
    copied: false,
    setCopied: (copied) => set({ copied }),
  }),
)
