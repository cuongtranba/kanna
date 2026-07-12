import { createScopedStore } from "../../lib/createScopedStore"

interface ImageGenerationMessageState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const ImageGenerationMessageStore = createScopedStore<void, ImageGenerationMessageState>(
  "ImageGenerationMessage",
  () => (set) => ({
    open: false,
    setOpen: (open) => set({ open }),
  }),
)
