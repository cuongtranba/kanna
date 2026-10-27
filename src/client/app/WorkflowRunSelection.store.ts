import { createScopedStore } from "../lib/createScopedStore"
import type { WorkflowRun } from "../../shared/workflow-types"

export type WorkflowRunSelection =
  | { kind: "none" }
  | { kind: "loading"; runId: string }
  | { kind: "loaded"; run: WorkflowRun }
  | { kind: "not-found"; runId: string }
  | { kind: "failed"; runId: string }

export const NO_RUN_SELECTION: WorkflowRunSelection = { kind: "none" }

export function selectedRunIdOf(selection: WorkflowRunSelection): string | null {
  if (selection.kind === "none") return null
  if (selection.kind === "loaded") return selection.run.runId
  return selection.runId
}

interface WorkflowRunSelectionState {
  selection: WorkflowRunSelection

  loadStarted: (runId: string) => void
  loaded: (runId: string, run: WorkflowRun | null) => void
  loadFailed: (runId: string) => void
  refreshed: (run: WorkflowRun) => void
  cleared: () => void
}

export const WorkflowRunSelectionStore = createScopedStore<void, WorkflowRunSelectionState>(
  "WorkflowRunSelection",
  () => (set) => ({
    selection: NO_RUN_SELECTION,

    loadStarted: (runId) => set({ selection: { kind: "loading", runId } }),
    loaded: (runId, run) => set({ selection: run ? { kind: "loaded", run } : { kind: "not-found", runId } }),
    loadFailed: (runId) => set({ selection: { kind: "failed", runId } }),
    refreshed: (run) => set({ selection: { kind: "loaded", run } }),
    cleared: () => set({ selection: NO_RUN_SELECTION }),
  }),
)
