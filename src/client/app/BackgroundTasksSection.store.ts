import { createScopedStore } from "../lib/createScopedStore"
import type { BackgroundTaskOutputSnapshot } from "../../shared/protocol"

interface BackgroundTasksSectionState {
  expandedTaskId: string | null
  output: Pick<BackgroundTaskOutputSnapshot, "taskId" | "content" | "truncated"> | null
  setExpandedTaskId: (id: string | null) => void
  setOutput: (output: Pick<BackgroundTaskOutputSnapshot, "taskId" | "content" | "truncated">) => void
}

export const BackgroundTasksSectionStore = createScopedStore<void, BackgroundTasksSectionState>(
  "BackgroundTasksSection",
  () => (set) => ({
    expandedTaskId: null,
    output: null,
    setExpandedTaskId: (id) => set({ expandedTaskId: id }),
    setOutput: (output) => set({ output }),
  }),
)
