import { createScopedStore } from "../lib/createScopedStore"

interface WorkflowsPageViewState {
  selectedAgentId: string | null

  setSelectedAgentId: (agentId: string | null) => void
}

export const WorkflowsPageViewStore = createScopedStore<void, WorkflowsPageViewState>(
  "WorkflowsPageView",
  () => (set) => ({
    selectedAgentId: null,

    setSelectedAgentId: (agentId) => set({ selectedAgentId: agentId }),
  }),
)
