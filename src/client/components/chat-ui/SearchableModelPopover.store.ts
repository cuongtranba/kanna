import type { StateCreator } from "zustand"
import { createScopedStore } from "../../lib/createScopedStore"

export interface SearchableModelPopoverState {
  open: boolean
  query: string

  setQuery: (query: string) => void
  setPopoverOpen: (open: boolean) => void
  closeAndClearQuery: () => void
}

export function createSearchableModelPopoverState(): StateCreator<SearchableModelPopoverState> {
  return (set) => ({
    open: false,
    query: "",

    setQuery: (query) => set({ query }),

    setPopoverOpen: (open) => set(open ? { open: true } : { open: false, query: "" }),

    closeAndClearQuery: () => set({ open: false, query: "" }),
  })
}

export const SearchableModelPopoverStore = createScopedStore<void, SearchableModelPopoverState>(
  "SearchableModelPopover",
  createSearchableModelPopoverState,
)
