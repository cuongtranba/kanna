import { createContext, useContext, type ReactNode } from "react"
import type { TranscriptEntry } from "../../../shared/types"

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
