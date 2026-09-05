import { createScopedStore } from "../../lib/createScopedStore"

interface ImageViewMessageState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const ImageViewMessageStore = createScopedStore<void, ImageViewMessageState>(
  "ImageViewMessage",
  () => (set) => ({
    open: false,
    setOpen: (open) => set({ open }),
  }),
)
