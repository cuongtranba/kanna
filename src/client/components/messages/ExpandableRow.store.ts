import { createScopedStore } from "../../lib/createScopedStore"

interface ExpandableRowState {
  expanded: boolean
  setExpanded: (expanded: boolean) => void
}

export const ExpandableRowStore = createScopedStore<{ defaultExpanded: boolean }, ExpandableRowState>(
  "ExpandableRow",
  ({ defaultExpanded }) => (set) => ({
    expanded: defaultExpanded,
    setExpanded: (expanded) => set({ expanded }),
  }),
)
