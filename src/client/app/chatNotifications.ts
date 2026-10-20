import { APP_NAME } from "../../shared/branding"
import type { SidebarData } from "../../shared/types"

const WAITING_TITLE_MAX_LENGTH = 40

export function getNotificationTitleCount(sidebarData: SidebarData, inboxUnread = 0) {
  return inboxUnread + sidebarData.projectGroups.reduce((count, group) => (
    count + group.chats.reduce((chatCount, chat) => (
      chatCount + (chat.unread ? 1 : 0) + (chat.status === "waiting_for_user" ? 1 : 0)
    ), 0)
  ), 0)
}

interface ChatNotificationSnapshot {
  unreadCount: number
  waitingChatIds: Set<string>
}

export function getChatNotificationSnapshot(sidebarData: SidebarData): ChatNotificationSnapshot {
  let unreadCount = 0
  const waitingChatIds = new Set<string>()

  for (const group of sidebarData.projectGroups) {
    for (const chat of group.chats) {
      if (chat.unread) unreadCount += 1
      if (chat.status === "waiting_for_user") {
        waitingChatIds.add(chat.chatId)
      }
    }
  }

  return { unreadCount, waitingChatIds }
}

export function getChatsNewlyWaiting(previous: SidebarData | null, next: SidebarData): string[] {
  if (!previous) return []

  const previousWaiting = getChatNotificationSnapshot(previous).waitingChatIds
  return [...getChatNotificationSnapshot(next).waitingChatIds].filter((chatId) => !previousWaiting.has(chatId))
}

export function getChatSoundBurstCount(previous: SidebarData | null, next: SidebarData): number {
  if (!previous) return 0

  const unreadIncrease = Math.max(
    0,
    getChatNotificationSnapshot(next).unreadCount - getChatNotificationSnapshot(previous).unreadCount,
  )
  return unreadIncrease + getChatsNewlyWaiting(previous, next).length
}

function truncateTitle(title: string): string {
  return title.length > WAITING_TITLE_MAX_LENGTH ? `${title.slice(0, WAITING_TITLE_MAX_LENGTH)}…` : title
}

export function getNotificationTitle(sidebarData: SidebarData, inboxUnread = 0): string {
  const count = getNotificationTitleCount(sidebarData, inboxUnread)
  if (count === 0) return APP_NAME

  const waitingTitles = sidebarData.projectGroups.flatMap((group) =>
    group.chats.filter((chat) => chat.status === "waiting_for_user").map((chat) => chat.title))

  if (waitingTitles.length === 1) {
    return `[${count}] Needs input: ${truncateTitle(waitingTitles[0])} · ${APP_NAME}`
  }
  if (waitingTitles.length > 1) {
    return `[${count}] ${waitingTitles.length} chats need input · ${APP_NAME}`
  }
  return `[${count}] ${APP_NAME}`
}
