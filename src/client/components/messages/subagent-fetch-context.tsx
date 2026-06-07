import { createContext, useContext, type ReactNode } from "react"
import type { TranscriptEntry } from "../../../shared/types"

/**
 * On-demand fetch for a native `Agent` subagent's child transcript. Provided
 * once near the transcript root (it captures the active chatId + socket) and
 * consumed by `SubagentTaskMessage` when the user expands the card — avoids
 * drilling a callback through every row / tool-group / tool-call layer.
 * `null` (the default, e.g. share view) means drill-in is unavailable.
 */
export type GetSubagentTranscript = (agentId: string) => Promise<TranscriptEntry[]>

const SubagentTranscriptFetchContext = createContext<GetSubagentTranscript | null>(null)

export function SubagentTranscriptFetchProvider({
  children,
  value,
}: {
  children: ReactNode
  value: GetSubagentTranscript | null
}) {
  return (
    <SubagentTranscriptFetchContext.Provider value={value}>
      {children}
    </SubagentTranscriptFetchContext.Provider>
  )
}

export function useSubagentTranscriptFetch(): GetSubagentTranscript | null {
  return useContext(SubagentTranscriptFetchContext)
}
