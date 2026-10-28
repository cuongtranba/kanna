import type { SidebarData } from "../../../shared/types"
import type { CardChatFacts } from "./cardWorkSignal"
import { allChatRows } from "../../../shared/sidebar-data"

export interface BoardChatFacts extends CardChatFacts {
  title: string
}

export const NO_BOARD_CHAT_FACTS: Readonly<Record<string, BoardChatFacts>> = {}

export function buildBoardChatFacts(sidebarData: SidebarData): Record<string, BoardChatFacts> {
  return Object.fromEntries(
    allChatRows(sidebarData).map((row) => [
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
