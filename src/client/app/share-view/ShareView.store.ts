import { createScopedStore } from "../../lib/createScopedStore"

const EMPTY_EXPANDED: Record<string, boolean> = {}

interface ShareViewState {
  toolGroupExpanded: Record<string, boolean>
  setToolGroupExpanded: (groupId: string, next: boolean) => void
}

export const ShareViewStore = createScopedStore<Record<string, never>, ShareViewState>(
  "ShareView",
  () => (set) => ({
    toolGroupExpanded: EMPTY_EXPANDED,
    setToolGroupExpanded: (groupId, next) =>
      set((state) => ({ toolGroupExpanded: { ...state.toolGroupExpanded, [groupId]: next } })),
  }),
)
