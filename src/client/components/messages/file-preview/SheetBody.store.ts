import { createScopedStore } from "../../../lib/createScopedStore"
import type { ShareOutcome } from "./actions"

interface SheetBodyState {
  dy: number
  shareOutcome: ShareOutcome | null
  setDy: (dy: number) => void
  setShareOutcome: (shareOutcome: ShareOutcome | null) => void
}

export const SheetBodyStore = createScopedStore<void, SheetBodyState>(
  "SheetBody",
  () => (set) => ({
    dy: 0,
    shareOutcome: null,
    setDy: (dy) => set({ dy }),
    setShareOutcome: (shareOutcome) => set({ shareOutcome }),
  }),
)
