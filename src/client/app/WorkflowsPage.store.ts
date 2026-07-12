import { createScopedStore } from "../lib/createScopedStore"
import type { WorkflowRun } from "../../shared/workflow-types"

export type WorkflowsPageSelectedRun = WorkflowRun | null | "loading" | "not-found"

interface WorkflowsPageViewState {
  selectedRunId: string | null
  selectedRun: WorkflowsPageSelectedRun
  selectedAgentId: string | null

  setSelectedRunId: (id: string | null) => void
  setSelectedRun: (run: WorkflowsPageSelectedRun) => void
  setSelectedAgentId: (agentId: string | null) => void
  clearSelection: () => void
}

export const WorkflowsPageViewStore = createScopedStore<void, WorkflowsPageViewState>(
  "WorkflowsPageView",
  () => (set) => ({
    selectedRunId: null,
    selectedRun: null,
    selectedAgentId: null,

    setSelectedRunId: (id) => set({ selectedRunId: id }),
    setSelectedRun: (run) => set({ selectedRun: run }),
    setSelectedAgentId: (agentId) => set({ selectedAgentId: agentId }),
    clearSelection: () => set({ selectedRunId: null, selectedRun: null, selectedAgentId: null }),
  }),
)
