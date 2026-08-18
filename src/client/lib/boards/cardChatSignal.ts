import { chatStatusIndicator, type ChatDotTone } from "../chatStatusIndicator"
import type { ChatActivity, KannaStatus } from "../../../shared/types"

/**
 * What a card says about the chats working it.
 *
 * Derived through `chatStatusIndicator` — the same table the sidebar row and
 * the pane tab draw from — so one chat cannot read "Running" in three places
 * and blank on the card. The card face used to key on `card.updatedBy.kind`
 * instead, which is ATTRIBUTION: it says an agent last wrote the row, not that
 * one is working now, so a card finished an hour ago looked identical to a card
 * mid-turn.
 */

/** The live facts a card reads. A structural subset of `SidebarChatRow`. */
export interface CardChatFacts {
  status: KannaStatus
  unread: boolean
  stateEnteredAt?: number
  activity: ChatActivity
}

export interface CardChatSignal {
  /** The chat the row is about — the newest one with something to say. */
  chatId: string
  /** Null when every linked chat is quiet: the row is then a count, not a state. */
  tone: ChatDotTone | null
  label: string
  linkedCount: number
  /**
   * When the chat entered its current state, for a live elapsed stamp — null
   * unless the state is one that is still going. A ticker beside "Failed" would
   * imply it has not stopped.
   */
  liveSince: number | null
}

const TICKING: ReadonlySet<KannaStatus> = new Set<KannaStatus>([
  "running",
  "starting",
  "waiting_for_user",
])

export function cardChatSignal(
  chatIds: readonly string[],
  statuses: Readonly<Record<string, CardChatFacts>>,
): CardChatSignal | null {
  // A link is evidence, not proof — the reaper deletes chats nobody wrote to,
  // so a card can outlive its chat and must not offer to open one that is gone.
  const known = chatIds.flatMap((chatId) => {
    const chat = statuses[chatId]
    return chat ? [{ chatId, chat }] : []
  })
  if (known.length === 0) return null

  for (const { chatId, chat } of known) {
    const indicator = chatStatusIndicator(chat)
    if (!indicator) continue
    return {
      chatId,
      tone: indicator.tone,
      label: indicator.label,
      linkedCount: known.length,
      liveSince: TICKING.has(chat.status) ? chat.stateEnteredAt ?? null : null,
    }
  }

  const first = known[0]
  if (!first) return null
  return {
    chatId: first.chatId,
    tone: null,
    label: known.length === 1 ? "1 chat" : `${String(known.length)} chats`,
    linkedCount: known.length,
    liveSince: null,
  }
}
