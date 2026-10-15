import { errorMessage } from "../../shared/errors"
import type { ClientCommand } from "../../shared/protocol"
import { useKannaStateStore } from "../stores/kannaStateStore"
import type { KannaSocket } from "./socket"

export async function sendWebhookCommand<TResult>(socket: KannaSocket | null, command: ClientCommand): Promise<TResult> {
  if (!socket) throw new Error("Not connected to the Kanna server")
  try {
    const result = await socket.command<TResult>(command)
    useKannaStateStore.getState().setCommandError(null)
    return result
  } catch (error) {
    useKannaStateStore.getState().setCommandError(errorMessage(error))
    throw error
  }
}
