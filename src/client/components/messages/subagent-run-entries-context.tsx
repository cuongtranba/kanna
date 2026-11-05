import { createContext, useContext, type ReactNode } from "react"
import type { ChatHistoryPage } from "../../../shared/types"

export type GetSubagentRunEntries = (chatId: string, runId: string, beforeCursor?: string) => Promise<ChatHistoryPage>

const SubagentRunEntriesContext = createContext<GetSubagentRunEntries | null>(null)

export function SubagentRunEntriesProvider({
  children,
  value,
}: {
  children: ReactNode
  value: GetSubagentRunEntries | null
}) {
  return (
    <SubagentRunEntriesContext.Provider value={value}>
      {children}
    </SubagentRunEntriesContext.Provider>
  )
}

export function useSubagentRunEntries(): GetSubagentRunEntries | null {
  return useContext(SubagentRunEntriesContext)
}
