import { createScopedStore } from "../../lib/createScopedStore"

interface SharePopoverBodyState {
  busy: boolean
  setBusy: (busy: boolean) => void
}

export const SharePopoverBodyStore = createScopedStore<void, SharePopoverBodyState>(
  "SharePopoverBody",
  () => (set) => ({
    busy: false,
    setBusy: (busy) => set({ busy }),
  }),
)
