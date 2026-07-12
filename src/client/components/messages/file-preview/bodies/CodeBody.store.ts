import { createScopedStore } from "../../../../lib/createScopedStore"

interface HighlightResult {
  key: string
  html: string
}

interface CodeBodyState {
  highlighted: HighlightResult | null
  setHighlighted: (highlighted: HighlightResult | null) => void
}

export const CodeBodyStore = createScopedStore<void, CodeBodyState>(
  "CodeBody",
  () => (set) => ({
    highlighted: null,
    setHighlighted: (highlighted) => set({ highlighted }),
  }),
)
