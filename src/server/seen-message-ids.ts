import type { TranscriptEntry } from "../shared/types"

export const MAX_SEEN_MESSAGE_IDS = 2000

export function messageIdOf(entry: TranscriptEntry): string | null {
  const messageId = entry.messageId
  return typeof messageId === "string" && messageId.length > 0 ? messageId : null
}

export class SeenMessageIds {
  private readonly byChat = new Map<string, Set<string>>()

  constructor(private readonly maxPerChat: number = MAX_SEEN_MESSAGE_IDS) {}

  has(chatId: string, messageId: string): boolean {
    return this.byChat.get(chatId)?.has(messageId) ?? false
  }

  record(chatId: string, entry: TranscriptEntry): void {
    const messageId = messageIdOf(entry)
    if (messageId === null) return
    let seen = this.byChat.get(chatId)
    if (!seen) {
      seen = new Set<string>()
      this.byChat.set(chatId, seen)
    }
    if (seen.has(messageId)) return
    if (seen.size >= this.maxPerChat) {
      const oldest = seen.values().next().value
      if (oldest !== undefined) seen.delete(oldest)
    }
    seen.add(messageId)
  }

  forget(chatId: string): void {
    this.byChat.delete(chatId)
  }

  count(chatId: string): number {
    return this.byChat.get(chatId)?.size ?? 0
  }

  tracks(chatId: string): boolean {
    return this.byChat.has(chatId)
  }
}
