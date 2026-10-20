import { errorMessage } from "../../shared/errors"
import { isJsonObject, type JsonValue } from "../../shared/json"
import type { InboxActivityItem, InboxThread } from "../../shared/inbox/types"
import type { ClientCommand } from "../../shared/protocol"
import type { KannaSocket } from "../app/socket"
import type { CommandReply } from "../ports/commandPort"
import { useKannaStateStore } from "../stores/kannaStateStore"

export interface InboxPageResult {
  threads: InboxThread[]
  items: InboxActivityItem[]
}

export async function sendInboxCommand<C extends ClientCommand>(socket: KannaSocket | null, command: C): Promise<CommandReply<C>> {
  if (!socket) throw new Error("Not connected to the Kanna server")
  try {
    const result = await socket.command(command)
    useKannaStateStore.getState().setCommandError(null)
    return result
  } catch (error) {
    useKannaStateStore.getState().setCommandError(errorMessage(error))
    throw error
  }
}

function hasStringId(value: JsonValue): boolean {
  return isJsonObject(value) && typeof value.id === "string"
}

export function isInboxPageResult(value: JsonValue): value is JsonValue & InboxPageResult {
  return (
    isJsonObject(value)
    && Array.isArray(value.threads)
    && Array.isArray(value.items)
    && value.threads.every(hasStringId)
    && value.items.every(hasStringId)
  )
}

export function readInboxPage(result: JsonValue): InboxPageResult {
  if (isInboxPageResult(result)) return result
  throw new Error("The server did not return an inbox page")
}
