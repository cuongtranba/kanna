import { createScopedStore } from "../lib/createScopedStore"
import type { HydratedTranscriptMessage } from "../../shared/types"

export type TranscriptLoadState = "loading" | "loaded" | "error"

const EMPTY_MESSAGES: HydratedTranscriptMessage[] = []

interface WorkflowAgentTranscriptState {
  loadState: TranscriptLoadState
  messages: HydratedTranscriptMessage[]
  error: string | null
  reloadNonce: number

  setLoaded: (messages: HydratedTranscriptMessage[]) => void
  setError: (error: string) => void
  refresh: () => void
}

export const WorkflowAgentTranscriptStore = createScopedStore<void, WorkflowAgentTranscriptState>(
  "WorkflowAgentTranscript",
  () => (set) => ({
    loadState: "loading",
    messages: EMPTY_MESSAGES,
    error: null,
    reloadNonce: 0,

    setLoaded: (messages) => set({ loadState: "loaded", messages }),
    setError: (error) => set({ loadState: "error", error }),
    refresh: () => set((state) => ({ loadState: "loading", error: null, reloadNonce: state.reloadNonce + 1 })),
  }),
)
