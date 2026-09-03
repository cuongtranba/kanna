/**
 * Stack CRUD and instruction-editing commands.
 *
 * Lives in its own module rather than in `useAppGlobalState.ts`, which sits on
 * its architecture-budget ceiling: the budget's prescribed remedy is to give
 * new code a module that owns it, not to raise the pin. `useAppGlobalState`
 * consumes this as one hook and spreads the result, so adding another command
 * here costs it nothing.
 *
 * Every handler follows the one error contract the rest of the app uses:
 * clear `commandError` on success, set it to the message on failure, never
 * throw at the caller — a failed sidebar action must not unmount the tree.
 */

import { useCallback } from "react"
import { useKannaStateStore } from "../stores/kannaStateStore"
import type { KannaSocket } from "./socket"

export interface StackCommands {
  /** `instructions` rides the create — the client has no stack id before the ack. */
  handleCreateStack: (title: string, projectIds: string[], instructions?: string) => Promise<void>
  handleRenameStack: (stackId: string, title: string) => Promise<void>
  handleRemoveStack: (stackId: string) => Promise<void>
  handleAddProjectToStack: (stackId: string, projectId: string) => Promise<void>
  handleRemoveProjectFromStack: (stackId: string, projectId: string) => Promise<void>
  /** Per-project conventions; empty string clears. */
  handleSetProjectInstructions: (projectId: string, instructions: string) => Promise<void>
  /** How a stack's projects relate; empty string clears. */
  handleSetStackInstructions: (stackId: string, instructions: string) => Promise<void>
}

export function useStackCommands(socket: KannaSocket): StackCommands {
  const run = useCallback(async (command: Parameters<KannaSocket["command"]>[0]) => {
    try {
      await socket.command(command)
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])

  const handleCreateStack = useCallback(
    (title: string, projectIds: string[], instructions?: string) =>
      run({ type: "stack.create", title, projectIds, ...(instructions ? { instructions } : {}) }),
    [run],
  )
  const handleRenameStack = useCallback(
    (stackId: string, title: string) => run({ type: "stack.rename", stackId, title }),
    [run],
  )
  const handleRemoveStack = useCallback(
    (stackId: string) => run({ type: "stack.remove", stackId }),
    [run],
  )
  const handleAddProjectToStack = useCallback(
    (stackId: string, projectId: string) => run({ type: "stack.addProject", stackId, projectId }),
    [run],
  )
  const handleRemoveProjectFromStack = useCallback(
    (stackId: string, projectId: string) => run({ type: "stack.removeProject", stackId, projectId }),
    [run],
  )
  const handleSetProjectInstructions = useCallback(
    (projectId: string, instructions: string) => run({ type: "project.setInstructions", projectId, instructions }),
    [run],
  )
  const handleSetStackInstructions = useCallback(
    (stackId: string, instructions: string) => run({ type: "stack.setInstructions", stackId, instructions }),
    [run],
  )

  return {
    handleCreateStack,
    handleRenameStack,
    handleRemoveStack,
    handleAddProjectToStack,
    handleRemoveProjectFromStack,
    handleSetProjectInstructions,
    handleSetStackInstructions,
  }
}
