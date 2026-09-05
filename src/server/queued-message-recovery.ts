
import { log } from "../shared/log"
import { addCounter } from "./observability"

export interface QueuedMessageRecoveryDeps {
  listChatsWithQueuedMessages(): string[]
  maybeStartNextQueuedMessage(chatId: string, options?: { replay?: boolean }): Promise<boolean>
}

export async function recoverQueuedMessages(
  deps: QueuedMessageRecoveryDeps,
): Promise<string[]> {
  const recovered: string[] = []
  for (const chatId of deps.listChatsWithQueuedMessages()) {
    try {
      if (await deps.maybeStartNextQueuedMessage(chatId, { replay: true })) {
        recovered.push(chatId)
        addCounter("kanna.queued_message.recovered", 1)
      }
    } catch (error) {
      log.warn("[kanna] queued-message recovery failed", { chatId, error: String(error) })
    }
  }
  return recovered
}
