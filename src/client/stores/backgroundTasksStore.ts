import { create, type StoreApi, type UseBoundStore } from "zustand"
import type { BackgroundTask } from "../../shared/types"

// ---------------------------------------------------------------------------
// Diff op type
// ---------------------------------------------------------------------------

export type BackgroundTaskDiffOp =
  | { op: "added"; task: BackgroundTask }
  | { op: "updated"; task: BackgroundTask }
  | { op: "removed"; task: BackgroundTask }

// ---------------------------------------------------------------------------
// Running-count rule
//   bash_shell  → running only when status === "running" (not "stopping")
//   all others  → always running (no terminal status; they exist = active)
// ---------------------------------------------------------------------------

function isTaskRunning(task: BackgroundTask): boolean {
  if (task.kind === "bash_shell") return task.status === "running"
  return true
}

// ---------------------------------------------------------------------------
// State + Actions interface
// ---------------------------------------------------------------------------

interface BackgroundTasksState {
  /** Live list, ordered by insertion. Internal index is maintained via Map. */
  tasks: BackgroundTask[]

  /**
   * Number of tasks currently considered active.
   * Derived synchronously from `tasks` on every mutation — no selector
   * overhead for consumers that only need the badge count.
   */
  runningCount: number

  /** Replace the entire task list (called on WS snapshot). */
  applySnapshot: (tasks: BackgroundTask[]) => void

  /** Apply a single added / updated / removed diff (called on WS event). */
  applyDiff: (diff: BackgroundTaskDiffOp) => void

  /**
   * Returns all tasks that carry a chatId matching the given value.
   * terminal_pty has no chatId and is never included.
   */
  byChat: (chatId: string) => BackgroundTask[]
}

// ---------------------------------------------------------------------------
// Internal helpers — operate on an ordered array + a Map for O(1) lookup
// ---------------------------------------------------------------------------

function computeRunningCount(tasks: BackgroundTask[]): number {
  let count = 0
  for (const task of tasks) {
    if (isTaskRunning(task)) count++
  }
  return count
}

function applySnapshotTo(tasks: BackgroundTask[]): { tasks: BackgroundTask[]; runningCount: number } {
  return { tasks, runningCount: computeRunningCount(tasks) }
}

function applyDiffTo(
  prevTasks: BackgroundTask[],
  diff: BackgroundTaskDiffOp
): { tasks: BackgroundTask[]; runningCount: number } {
  let nextTasks: BackgroundTask[]
  if (diff.op === "added") {
    nextTasks = [...prevTasks, diff.task]
  } else if (diff.op === "removed") {
    nextTasks = prevTasks.filter((t) => t.id !== diff.task.id)
  } else {
    // updated — replace in place, preserving order
    nextTasks = prevTasks.map((t) => (t.id === diff.task.id ? diff.task : t))
  }
  return { tasks: nextTasks, runningCount: computeRunningCount(nextTasks) }
}

// ---------------------------------------------------------------------------
// Factory (exported for testability — creates an isolated store instance)
// ---------------------------------------------------------------------------

export type BackgroundTasksStore = UseBoundStore<StoreApi<BackgroundTasksState>>

export function createBackgroundTasksStore(): BackgroundTasksStore {
  return create<BackgroundTasksState>()((set, get) => ({
    tasks: [],
    runningCount: 0,

    applySnapshot: (tasks) => set(applySnapshotTo(tasks)),

    applyDiff: (diff) => set((state) => applyDiffTo(state.tasks, diff)),

    byChat: (chatId) =>
      get().tasks.filter((t) => "chatId" in t && t.chatId === chatId),
  }))
}

// ---------------------------------------------------------------------------
// Singleton store (used by React components and the WS subscription wiring)
// ---------------------------------------------------------------------------

export const useBackgroundTasksStore = createBackgroundTasksStore()

/**
 * Selector hook: number of currently-running background tasks.
 * Drives the navbar indicator badge (Task 9).
 */
export function useRunningTaskCount(): number {
  return useBackgroundTasksStore((state) => state.runningCount)
}
