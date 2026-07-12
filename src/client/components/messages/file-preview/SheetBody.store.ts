import { createScopedStore } from "../../../lib/createScopedStore"

interface SheetBodyState {
  dy: number
  setDy: (dy: number) => void
}

export const SheetBodyStore = createScopedStore<void, SheetBodyState>(
  "SheetBody",
  () => (set) => ({
    dy: 0,
    setDy: (dy) => set({ dy }),
  }),
)
