import { createScopedStore } from "../../lib/createScopedStore"

interface SharePopoverBodyState {
  error: string | null
  copiedTokenId: string | null
  setError: (error: string | null) => void
  markCopied: (tokenId: string) => void
}

export const SharePopoverBodyStore = createScopedStore<void, SharePopoverBodyState>(
  "SharePopoverBody",
  () => (set) => ({
    error: null,
    copiedTokenId: null,
    setError: (error) => set({ error }),
    markCopied: (tokenId) => set({ copiedTokenId: tokenId, error: null }),
  }),
)
