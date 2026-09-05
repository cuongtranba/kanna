import type { SidebarData } from "../../../shared/types"
import type { CardChatFacts } from "./cardWorkSignal"

export interface BoardChatFacts extends CardChatFacts {
  title: string
}

export const NO_BOARD_CHAT_FACTS: Readonly<Record<string, BoardChatFacts>> = {}

export function buildBoardChatFacts(sidebarData: SidebarData): Record<string, BoardChatFacts> {
  const rows = [...sidebarData.starredProjectGroups, ...sidebarData.projectGroups].flatMap(
    (group) => [...group.chats, ...group.previewChats, ...group.olderChats],
  )

  return Object.fromEntries(
    rows.map((row) => [
      row.chatId,
      {
        title: row.title,
        status: row.status,
        unread: row.unread,
        activity: row.activity,
        ...(row.stateEnteredAt == null ? {} : { stateEnteredAt: row.stateEnteredAt }),
      },
    ]),
  )
}
