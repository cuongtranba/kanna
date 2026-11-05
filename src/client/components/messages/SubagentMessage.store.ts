import { createScopedStore } from "../../lib/createScopedStore"
import type { TranscriptEntry } from "../../../shared/types"

interface SubagentMessageState {
  expanded: boolean
  fullEntries: TranscriptEntry[] | null
  error: string | null
  openLog: () => void
  closeLog: () => void
  receiveEntries: (entries: TranscriptEntry[]) => void
  failLoad: (message: string) => void
}

export const SubagentMessageStore = createScopedStore<void, SubagentMessageState>(
  "SubagentMessage",
  () => (set) => ({
    expanded: false,
    fullEntries: null,
    error: null,
    openLog: () => set({ expanded: true, error: null }),
    closeLog: () => set({ expanded: false, fullEntries: null, error: null }),
    receiveEntries: (entries) => set({ fullEntries: entries }),
    failLoad: (message) => set({ error: message }),
  }),
)
