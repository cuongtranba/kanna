import { errorMessage } from "../../shared/errors"
import type { ClientCommand } from "../../shared/protocol"
import type { CommandPort, CommandReply } from "../ports/commandPort"
import { useKannaStateStore } from "../stores/kannaStateStore"

const NOT_CONNECTED_MESSAGE = "Not connected to the Kanna server"

export function clearCommandError(): void {
  useKannaStateStore.getState().setCommandError(null)
}

export function reportCommandFailure(error: Error): void {
  useKannaStateStore.getState().setCommandError(error.message)
}

export async function withCommandFeedback<T>(run: () => Promise<T>): Promise<T> {
  try {
    const result = await run()
    clearCommandError()
    return result
  } catch (error) {
    useKannaStateStore.getState().setCommandError(errorMessage(error))
    throw error
  }
}

export async function surfaceCommandError<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await run()
    clearCommandError()
    return result
  } catch (error) {
    useKannaStateStore.getState().setCommandError(errorMessage(error))
    return undefined
  }
}

export async function sendCommandWithFeedback<C extends ClientCommand>(
  socket: CommandPort | null,
  command: C,
): Promise<CommandReply<C>> {
  return await withCommandFeedback(async () => {
    if (!socket) throw new Error(NOT_CONNECTED_MESSAGE)
    return await socket.command(command)
  })
}

export async function surfaceErrorIn(setError: (message: string | null) => void, run: () => Promise<void>): Promise<void> {
  setError(null)
  try {
    await run()
  } catch (error) {
    setError(errorMessage(error))
  }
}
