import { createScopedStore } from "../../lib/createScopedStore"

interface ThinkingBlockState {
  expanded: boolean
  setExpanded: (expanded: boolean) => void
}

export const ThinkingBlockStore = createScopedStore<void, ThinkingBlockState>(
  "ThinkingBlock",
  () => (set) => ({
    expanded: false,
    setExpanded: (expanded) => set({ expanded }),
  }),
)
