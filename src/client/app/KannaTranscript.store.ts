import { createScopedStore } from "../lib/createScopedStore"

interface KannaTranscriptState {
  toolGroupExpanded: Record<string, boolean>
  setToolGroupExpanded: (groupId: string, next: boolean) => void
}

export const KannaTranscriptStore = createScopedStore<Record<string, never>, KannaTranscriptState>(
  "KannaTranscript",
  () => (set) => ({
    toolGroupExpanded: {},
    setToolGroupExpanded: (groupId, next) =>
      set((state) =>
        state.toolGroupExpanded[groupId] === next
          ? state
          : { toolGroupExpanded: { ...state.toolGroupExpanded, [groupId]: next } }
      ),
  }),
)
