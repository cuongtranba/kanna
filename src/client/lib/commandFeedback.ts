import { errorMessage, toError } from "../../shared/errors"
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

type CommandOutcome<T> = { ok: true; value: T } | { ok: false; error: Error }

async function settleWithFeedback<T>(run: () => Promise<T>): Promise<CommandOutcome<T>> {
  try {
    const value = await run()
    clearCommandError()
    return { ok: true, value }
  } catch (error) {
    const failure = toError(error)
    reportCommandFailure(failure)
    return { ok: false, error: failure }
  }
}

export async function withCommandFeedback<T>(run: () => Promise<T>): Promise<T> {
  const outcome = await settleWithFeedback(run)
  if (!outcome.ok) throw outcome.error
  return outcome.value
}

export async function surfaceCommandError<T>(run: () => Promise<T>): Promise<T | undefined> {
  const outcome = await settleWithFeedback(run)
  return outcome.ok ? outcome.value : undefined
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

export async function surfaceErrorIn<T>(setError: (message: string | null) => void, run: () => Promise<T>): Promise<void> {
  setError(null)
  try {
    await run()
  } catch (error) {
    setError(errorMessage(error))
  }
}
