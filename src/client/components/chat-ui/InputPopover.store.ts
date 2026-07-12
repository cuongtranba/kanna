import { createScopedStore } from "../../lib/createScopedStore"

interface InputPopoverState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const InputPopoverStore = createScopedStore<void, InputPopoverState>(
  "InputPopover",
  () => (set) => ({
    open: false,
    setOpen: (open) => set({ open }),
  }),
)
