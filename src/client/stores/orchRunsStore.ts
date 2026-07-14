import { create } from "zustand"
import type { OrchRunSummary } from "../../shared/orchestration-types"

const EMPTY: OrchRunSummary[] = []

interface OrchRunsState {
  runs: OrchRunSummary[]
  setRuns(runs: OrchRunSummary[]): void
}

export const useOrchRunsStore = create<OrchRunsState>()((set) => ({
  runs: EMPTY,
  setRuns: (runs) => set({ runs }),
}))

export function selectOrchRuns(s: OrchRunsState): OrchRunSummary[] {
  return s.runs ?? EMPTY
}
