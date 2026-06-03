import { create } from "zustand"
import type { WorkflowRunSummary } from "../../shared/workflow-types"

const EMPTY: WorkflowRunSummary[] = []

interface WorkflowsState {
  byChat: Record<string, WorkflowRunSummary[]>
  setRuns(chatId: string, runs: WorkflowRunSummary[]): void
}

export const useWorkflowsStore = create<WorkflowsState>()((set) => ({
  byChat: {},
  setRuns: (chatId, runs) =>
    set((s) => ({ byChat: { ...s.byChat, [chatId]: runs } })),
}))

export function selectRuns(chatId: string) {
  return (s: WorkflowsState): WorkflowRunSummary[] => s.byChat[chatId] ?? EMPTY
}
