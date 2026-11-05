import { createScopedStore } from "../../lib/createScopedStore"
import { mergeTranscriptEntries } from "../../lib/mergeTranscriptEntries"
import type { ChatHistoryPage, TranscriptEntry } from "../../../shared/types"

interface SubagentMessageState {
  expanded: boolean
  fullEntries: TranscriptEntry[] | null
  olderCursor: string | null
  hasOlder: boolean
  error: string | null
  openLog: () => void
  closeLog: () => void
  receiveNewest: (page: ChatHistoryPage) => void
  receiveOlder: (requestedCursor: string, page: ChatHistoryPage) => void
  failLoad: (message: string) => void
}

export const SubagentMessageStore = createScopedStore<void, SubagentMessageState>(
  "SubagentMessage",
  () => (set) => ({
    expanded: false,
    fullEntries: null,
    olderCursor: null,
    hasOlder: false,
    error: null,
    openLog: () => set({ expanded: true, error: null }),
    closeLog: () => set({ expanded: false, fullEntries: null, olderCursor: null, hasOlder: false, error: null }),
    receiveNewest: (page) =>
      set((state) =>
        state.expanded
          ? { fullEntries: page.messages, olderCursor: page.olderCursor, hasOlder: page.hasOlder, error: null }
          : state,
      ),
    receiveOlder: (requestedCursor, page) =>
      set((state) =>
        state.expanded && state.olderCursor === requestedCursor
          ? {
              fullEntries: mergeTranscriptEntries(page.messages, state.fullEntries ?? []),
              olderCursor: page.olderCursor,
              hasOlder: page.hasOlder,
              error: null,
            }
          : state,
      ),
    failLoad: (message) => set((state) => (state.expanded ? { error: message } : state)),
  }),
)
