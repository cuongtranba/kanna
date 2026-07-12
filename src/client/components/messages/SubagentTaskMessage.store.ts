import { createScopedStore } from "../../lib/createScopedStore"
import type { HydratedTranscriptMessage } from "../../../shared/types"

const EMPTY_CHILDREN: HydratedTranscriptMessage[] = []

interface SubagentTaskMessageState {
  expanded: boolean
  loading: boolean
  loaded: boolean
  children: HydratedTranscriptMessage[]
  error: string | null
  setExpanded: (expanded: boolean) => void
  setLoading: (loading: boolean) => void
  setLoaded: (loaded: boolean) => void
  setChildren: (children: HydratedTranscriptMessage[]) => void
  setError: (error: string | null) => void
}

export const SubagentTaskMessageStore = createScopedStore<void, SubagentTaskMessageState>(
  "SubagentTaskMessage",
  () => (set) => ({
    expanded: false,
    loading: false,
    loaded: false,
    children: EMPTY_CHILDREN,
    error: null,
    setExpanded: (expanded) => set({ expanded }),
    setLoading: (loading) => set({ loading }),
    setLoaded: (loaded) => set({ loaded }),
    setChildren: (children) => set({ children }),
    setError: (error) => set({ error }),
  }),
)
