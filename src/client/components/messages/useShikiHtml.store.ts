import { createScopedStore } from "../../lib/createScopedStore"

interface HighlightedState {
  source: string
  theme: string
  lang: string
  html: string
}

interface ShikiHtmlState {
  highlighted: HighlightedState | null
  setHighlighted: (highlighted: HighlightedState | null) => void
}

export const ShikiHtmlStore = createScopedStore<void, ShikiHtmlState>(
  "ShikiHtml",
  () => (set) => ({
    highlighted: null,
    setHighlighted: (highlighted) => set({ highlighted }),
  }),
)
