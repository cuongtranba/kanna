
import { useCallback } from "react"
import { useKannaStateStore } from "../stores/kannaStateStore"
import type { KannaSocket } from "./socket"

export interface StackCommands {
  handleCreateStack: (title: string, projectIds: string[], instructions?: string) => Promise<void>
  handleRenameStack: (stackId: string, title: string) => Promise<void>
  handleRemoveStack: (stackId: string) => Promise<void>
  handleAddProjectToStack: (stackId: string, projectId: string) => Promise<void>
  handleRemoveProjectFromStack: (stackId: string, projectId: string) => Promise<void>
  handleSetProjectInstructions: (projectId: string, instructions: string) => Promise<void>
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
