import type { StateCreator } from "zustand"
import { createScopedStore } from "../../lib/createScopedStore"

export interface SearchableSelectState {
  open: boolean
  query: string
  activeIndex: number

  setQuery: (query: string) => void
  setOpen: (open: boolean) => void
  moveActive: (delta: number, count: number) => void
  close: () => void
}

export function createSearchableSelectState(): StateCreator<SearchableSelectState> {
  return (set) => ({
    open: false,
    query: "",
    activeIndex: 0,

    setQuery: (query) => set({ query, activeIndex: 0 }),

    setOpen: (open) => set(open ? { open: true } : { open: false, query: "", activeIndex: 0 }),

    moveActive: (delta, count) =>
      set((state) => (count === 0 ? state : { activeIndex: (state.activeIndex + delta + count) % count })),

    close: () => set({ open: false, query: "", activeIndex: 0 }),
  })
}

export const SearchableSelectStore = createScopedStore<void, SearchableSelectState>(
  "SearchableSelect",
  createSearchableSelectState,
)
