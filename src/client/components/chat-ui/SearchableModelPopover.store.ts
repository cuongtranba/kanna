import { createScopedStore } from "../../lib/createScopedStore"

interface SearchableModelPopoverState {
  open: boolean
  query: string
  setOpen: (open: boolean) => void
  setQuery: (query: string) => void
  closeAndClearQuery: () => void
}

export const SearchableModelPopoverStore = createScopedStore<void, SearchableModelPopoverState>(
  "SearchableModelPopover",
  () => (set) => ({
    open: false,
    query: "",
    setOpen: (open) => set({ open }),
    setQuery: (query) => set({ query }),
    closeAndClearQuery: () => set({ open: false, query: "" }),
  }),
)
