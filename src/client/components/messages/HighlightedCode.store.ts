import { createScopedStore } from "../../lib/createScopedStore"

interface HighlightedState {
  source: string
  theme: string
  lang: string
  html: string
}

interface HighlightedCodeState {
  highlighted: HighlightedState | null
  setHighlighted: (highlighted: HighlightedState | null) => void
}

export const HighlightedCodeStore = createScopedStore<void, HighlightedCodeState>(
  "HighlightedCode",
  () => (set) => ({
    highlighted: null,
    setHighlighted: (highlighted) => set({ highlighted }),
  }),
)
