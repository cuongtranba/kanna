import { create } from "zustand"
import type { McpSourceStatus } from "../../shared/mcp-sources/types"

const EMPTY: readonly McpSourceStatus[] = []

interface McpSourcesState {
  statuses: readonly McpSourceStatus[]
  setStatuses(statuses: readonly McpSourceStatus[]): void
}

export const useMcpSourcesStore = create<McpSourcesState>()((set) => ({
  statuses: EMPTY,
  setStatuses: (statuses) => set({ statuses }),
}))
