import type { SidebarData } from "../../../shared/types"
import type { CardChatFacts } from "./cardWorkSignal"

/**
 * The chat facts a board needs, gathered from the live sidebar snapshot rather
 * than fetched per card.
 *
 * The sidebar already holds every chat the workspace knows about, refreshed on
 * every status change, so a board that reads from it is current by
 * construction — and cannot disagree with the sidebar row for the same chat.
 * Keyed by chat id because that is what a card's link carries; a chat missing
 * from this map is a chat that no longer exists.
 *
 * `title` rides along for the drawer's linked-chat list. The card face needs
 * only `CardChatFacts`, which this is a supertype of, so one gather serves
 * both surfaces instead of two passes over the same rows.
 */
export interface BoardChatFacts extends CardChatFacts {
  title: string
}

/** Shared empty map: a fresh `{}` per render would re-run every consumer's memo. */
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
