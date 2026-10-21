import { errorMessage } from "../../shared/errors"
import { isJsonObject, type JsonValue } from "../../shared/json"
import type { ClientCommand } from "../../shared/protocol"
import { useKannaStateStore } from "../stores/kannaStateStore"
import type { WebhookSecretReveal } from "../stores/webhooksStore"
import type { KannaSocket } from "./socket"
import type { CommandReply } from "../ports/commandPort"

export async function sendWebhookCommand<C extends ClientCommand>(socket: KannaSocket | null, command: C): Promise<CommandReply<C>> {
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

export function readRevealedSecret(result: JsonValue, hookId: string, hookName: string): WebhookSecretReveal {
  if (isJsonObject(result) && typeof result.secret === "string") {
    return { hookId, hookName, secret: result.secret }
  }
  throw new Error("The server did not return a secret")
}

export function readCreatedWebhook(result: JsonValue): WebhookSecretReveal | null {
  const hook = isJsonObject(result) ? result.hook : null
  if (hook && isJsonObject(hook) && typeof hook.id === "string" && typeof hook.name === "string") {
    if (hook.kind === "slack" && !(isJsonObject(result) && typeof result.secret === "string")) return null
    return readRevealedSecret(result, hook.id, hook.name)
  }
  throw new Error("The server did not return the new webhook")
}
