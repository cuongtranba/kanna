import { createScopedStore } from "../lib/createScopedStore"
import type { OrchRunDetail } from "../../shared/orchestration-types"

export type OrchSelectedRun = OrchRunDetail | null | "loading"

interface OrchestrationSectionDetailState {
  selectedRun: OrchSelectedRun
  selectedRunId: string | null

  setSelectedRun: (run: OrchSelectedRun) => void
  setSelectedRunId: (id: string | null) => void
  clearSelection: () => void
}

export const OrchestrationSectionDetailStore = createScopedStore<void, OrchestrationSectionDetailState>(
  "OrchestrationSectionDetail",
  () => (set) => ({
    selectedRun: null,
    selectedRunId: null,

    setSelectedRun: (run) => set({ selectedRun: run }),
    setSelectedRunId: (id) => set({ selectedRunId: id }),
    clearSelection: () => set({ selectedRun: null, selectedRunId: null }),
  }),
)
