import type { StateCreator } from "zustand"
import { createScopedStore } from "../../../lib/createScopedStore"

export interface StackChatCreateRowState {
  selectedWorktrees: Map<string, string>
  primaryProjectId: string
  isSubmitting: boolean
  errorMessage: string | null

  /** Pick the worktree for one project; the Map is rebuilt inside the store. */
  selectWorktree: (projectId: string, worktreePath: string) => void
  setPrimaryProjectId: (id: string) => void
  setIsSubmitting: (submitting: boolean) => void
  setErrorMessage: (message: string | null) => void
}

export interface StackChatCreateRowInit {
  initialPrimaryProjectId: string
  initialSelectedWorktrees: Map<string, string>
}

export function createStackChatCreateRowState(
  init: StackChatCreateRowInit,
): StateCreator<StackChatCreateRowState> {
  return (set) => ({
    selectedWorktrees: init.initialSelectedWorktrees,
    primaryProjectId: init.initialPrimaryProjectId,
    isSubmitting: false,
    errorMessage: null,

    selectWorktree: (projectId, worktreePath) =>
      set((state) => {
        if (state.selectedWorktrees.get(projectId) === worktreePath) return state
        const next = new Map(state.selectedWorktrees)
        next.set(projectId, worktreePath)
        return { selectedWorktrees: next }
      }),

    setPrimaryProjectId: (id) => set({ primaryProjectId: id }),
    setIsSubmitting: (submitting) => set({ isSubmitting: submitting }),
    setErrorMessage: (message) => set({ errorMessage: message }),
  })
}

export const stackChatCreateRowStore = createScopedStore<
  StackChatCreateRowInit,
  StackChatCreateRowState
>("StackChatCreateRow", createStackChatCreateRowState)
