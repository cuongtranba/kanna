import { errorMessage } from "../../shared/errors"
import { isJsonObject, type JsonValue } from "../../shared/json"
import type { ClientCommand } from "../../shared/protocol"
import { useKannaStateStore } from "../stores/kannaStateStore"
import type { WebhookSecretReveal } from "../stores/webhooksStore"
import type { KannaSocket } from "./socket"

export async function sendWebhookCommand(socket: KannaSocket | null, command: ClientCommand): Promise<JsonValue> {
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

export function readCreatedWebhook(result: JsonValue): WebhookSecretReveal {
  const hook = isJsonObject(result) ? result.hook : null
  if (hook && isJsonObject(hook) && typeof hook.id === "string" && typeof hook.name === "string") {
    return readRevealedSecret(result, hook.id, hook.name)
  }
  throw new Error("The server did not return the new webhook")
}
