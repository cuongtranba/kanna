import { useCallback } from "react"
import type { SidebarData } from "../../shared/types"
import { useKannaStateStore } from "../stores/kannaStateStore"
import type { ChatNavigatorPort } from "./chatNavigator"
import type { KannaSocket } from "./socket"

export function getNewestRemainingChatId(
  projectGroups: SidebarData["projectGroups"],
  activeChatId: string,
  removedChatIds: readonly string[] = [activeChatId],
): string | null {
  const projectGroup = projectGroups.find((group) => group.chats.some((chat) => chat.chatId === activeChatId))
  if (!projectGroup) return null

  return projectGroup.chats.find((chat) => !removedChatIds.includes(chat.chatId))?.chatId ?? null
}

export function useBulkArchiveChats(
  socket: KannaSocket,
  chatNavigator: ChatNavigatorPort,
  activeChatId: string | null,
  sidebarProjectGroups: SidebarData["projectGroups"],
) {
  return useCallback(async (chatIds: string[]) => {
    if (!chatIds.length) return
    try {
      for (const chatId of chatIds) {
        await socket.command({ type: "chat.archive", chatId })
      }
      if (activeChatId != null && chatIds.includes(activeChatId)) {
        const nextChatId = getNewestRemainingChatId(sidebarProjectGroups, activeChatId, chatIds)
        if (nextChatId) {
          chatNavigator.openChat(nextChatId)
        } else {
          chatNavigator.closeChat()
        }
      }
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, chatNavigator, sidebarProjectGroups, socket])
}
