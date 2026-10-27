import { useCallback } from "react"
import type { AgentProvider, SidebarData } from "../../shared/types"
import { surfaceCommandError } from "../lib/commandFeedback"
import { useChatPreferencesStore, type ComposerState } from "../stores/chatPreferencesStore"
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

export function leaveRemovedChats(
  removedChatIds: readonly string[],
  activeChatId: string | null,
  projectGroups: SidebarData["projectGroups"],
  chatNavigator: ChatNavigatorPort,
): void {
  if (activeChatId === null || !removedChatIds.includes(activeChatId)) return
  const nextChatId = getNewestRemainingChatId(projectGroups, activeChatId, removedChatIds)
  if (nextChatId) {
    chatNavigator.openChat(nextChatId)
  } else {
    chatNavigator.closeChat()
  }
}

export interface AdoptedChat {
  chatId: string
  projectId?: string
  sourceState: ComposerState
  providerHint?: AgentProvider | null
}

export function adoptNewChat(chatNavigator: ChatNavigatorPort, chat: AdoptedChat): void {
  useChatPreferencesStore.getState().initializeComposerForChat(chat.chatId, {
    sourceState: chat.sourceState,
    providerHint: chat.providerHint,
  })
  const store = useKannaStateStore.getState()
  if (chat.projectId !== undefined) store.setSelectedProjectId(chat.projectId)
  store.setPendingChatId(chat.chatId)
  chatNavigator.openChat(chat.chatId)
  store.setSidebarOpen(false)
  store.setCommandError(null)
}

export function useBulkArchiveChats(
  socket: KannaSocket,
  chatNavigator: ChatNavigatorPort,
  activeChatId: string | null,
  sidebarProjectGroups: SidebarData["projectGroups"],
) {
  return useCallback(async (chatIds: string[]) => {
    if (!chatIds.length) return
    await surfaceCommandError(async () => {
      for (const chatId of chatIds) {
        await socket.command({ type: "chat.archive", chatId })
      }
      leaveRemovedChats(chatIds, activeChatId, sidebarProjectGroups, chatNavigator)
    })
  }, [activeChatId, chatNavigator, sidebarProjectGroups, socket])
}
