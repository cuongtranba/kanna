import type { TranscriptEntry } from "../shared/types"
import { timestamped } from "./claude-message-normalizer"

export interface TurnErrorAppendStore {
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
}

export interface TurnErrorStore extends TurnErrorAppendStore {
  recordTurnFailed(chatId: string, error: string): Promise<void>
}

export async function appendTurnError(
  store: TurnErrorAppendStore,
  chatId: string,
  message: string,
  durationMs = 0,
): Promise<void> {
  await store.appendMessage(
    chatId,
    timestamped({
      kind: "result",
      subtype: "error",
      isError: true,
      durationMs,
      result: message,
    }),
  )
}

export async function recordTurnError(
  store: TurnErrorStore,
  chatId: string,
  message: string,
  durationMs = 0,
): Promise<void> {
  await appendTurnError(store, chatId, message, durationMs)
  await store.recordTurnFailed(chatId, message)
}
