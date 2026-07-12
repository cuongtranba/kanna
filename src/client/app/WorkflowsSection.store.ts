import { createScopedStore } from "../lib/createScopedStore"
import type { WorkflowRun } from "../../shared/workflow-types"

export type WorkflowsSectionSelectedRun = WorkflowRun | null | "loading"

interface WorkflowsSectionDetailState {
  selectedRun: WorkflowsSectionSelectedRun
  selectedRunId: string | null

  setSelectedRun: (run: WorkflowsSectionSelectedRun) => void
  setSelectedRunId: (id: string | null) => void
  clearSelection: () => void
}

export const WorkflowsSectionDetailStore = createScopedStore<void, WorkflowsSectionDetailState>(
  "WorkflowsSectionDetail",
  () => (set) => ({
    selectedRun: null,
    selectedRunId: null,

    setSelectedRun: (run) => set({ selectedRun: run }),
    setSelectedRunId: (id) => set({ selectedRunId: id }),
    clearSelection: () => set({ selectedRun: null, selectedRunId: null }),
  }),
)
