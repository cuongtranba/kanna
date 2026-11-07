import { STORE_VERSION } from "../shared/core-types"
import type { ChatToolEvent, PendingChatTool } from "./events"

export type PendingChatToolMap = Map<string, Map<string, PendingChatTool>>

export function applyChatToolEvent(pendingByChatId: PendingChatToolMap, event: ChatToolEvent): void {
  switch (event.type) {
    case "chat_tool_pending": {
      const forChat = pendingByChatId.get(event.chatId) ?? new Map<string, PendingChatTool>()
      forChat.set(event.toolUseId, {
        toolUseId: event.toolUseId,
        toolKind: event.toolKind,
        input: event.input,
        requestedAt: event.timestamp,
      })
      pendingByChatId.set(event.chatId, forChat)
      break
    }
    case "chat_tool_resolved": {
      const forChat = pendingByChatId.get(event.chatId)
      if (!forChat) break
      forChat.delete(event.toolUseId)
      if (forChat.size === 0) pendingByChatId.delete(event.chatId)
      break
    }
  }
}

export function listPendingChatTools(pendingByChatId: PendingChatToolMap, chatId: string): PendingChatTool[] {
  return [...(pendingByChatId.get(chatId)?.values() ?? [])]
}

export function listAllPendingChatTools(
  pendingByChatId: PendingChatToolMap,
): Array<{ chatId: string; tool: PendingChatTool }> {
  const all: Array<{ chatId: string; tool: PendingChatTool }> = []
  for (const [chatId, forChat] of pendingByChatId) {
    for (const tool of forChat.values()) all.push({ chatId, tool })
  }
  return all
}

export function danglingChatToolResolutions(pendingByChatId: PendingChatToolMap, now: number): ChatToolEvent[] {
  return listAllPendingChatTools(pendingByChatId).map(({ chatId, tool }) => ({
    v: STORE_VERSION,
    type: "chat_tool_resolved",
    timestamp: now,
    chatId,
    toolUseId: tool.toolUseId,
    resolution: "interrupted",
  }))
}
