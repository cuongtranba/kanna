import { describe, expect, test } from "bun:test"
import { cardChatSignal, type CardChatFacts } from "./cardChatSignal"

/**
 * The card face's third row. It exists to answer one question at a glance —
 * "is an agent working this card right now" — and to say nothing at all when
 * the answer is no, which is what keeps a 200-card board readable.
 */

function facts(rows: Record<string, CardChatFacts>): Record<string, CardChatFacts> {
  return rows
}

const IDLE: CardChatFacts = { status: "idle", unread: false }

describe("cardChatSignal", () => {
  test("says nothing for a card with no linked chat", () => {
    expect(cardChatSignal([], facts({}))).toBeNull()
  })

  /**
   * A link is evidence, not proof: the stale-empty-chat reaper deletes chats
   * nobody wrote to, so a card can outlive its chat. Claiming a count that
   * includes a chat the reader cannot open would be a lie.
   */
  test("ignores links whose chat no longer exists", () => {
    expect(cardChatSignal(["gone-1", "gone-2"], facts({}))).toBeNull()
  })

  test("reports a running chat with its tone and the moment it started", () => {
    const signal = cardChatSignal(
      ["chat-1"],
      facts({ "chat-1": { status: "running", unread: false, stateEnteredAt: 1_000 } }),
    )

    expect(signal).toEqual({
      chatId: "chat-1",
      tone: "warning",
      label: "Running",
      linkedCount: 1,
      liveSince: 1_000,
    })
  })

  test("a chat waiting on the user reads as info, not as running", () => {
    const signal = cardChatSignal(
      ["chat-1"],
      facts({ "chat-1": { status: "waiting_for_user", unread: false, stateEnteredAt: 5 } }),
    )
    expect(signal?.tone).toBe("info")
    expect(signal?.liveSince).toBe(5)
  })

  test("a failed chat reads as destructive and carries no ticker", () => {
    const signal = cardChatSignal(
      ["chat-1"],
      facts({ "chat-1": { status: "failed", unread: false, stateEnteredAt: 5 } }),
    )
    expect(signal?.tone).toBe("destructive")
    // Failure is not a duration; a ticker on it would imply it is still going.
    expect(signal?.liveSince).toBeNull()
  })

  /** Silence is the healthy state — but the card still admits the chat exists. */
  test("quiet chats report a count and no tone", () => {
    const signal = cardChatSignal(
      ["chat-2", "chat-1"],
      facts({ "chat-1": IDLE, "chat-2": IDLE }),
    )

    expect(signal).toEqual({
      chatId: "chat-2",
      tone: null,
      label: "2 chats",
      linkedCount: 2,
      liveSince: null,
    })
  })

  test("one quiet chat is singular", () => {
    expect(cardChatSignal(["chat-1"], facts({ "chat-1": IDLE }))?.label).toBe("1 chat")
  })

  /**
   * Newest first, the same rule `deriveStartWorkStatus` picks a card's live
   * chat by — so the drawer's button and the card's dot cannot disagree about
   * which chat the card is "on".
   */
  test("takes the newest chat that has something to say", () => {
    const signal = cardChatSignal(
      ["chat-new", "chat-old"],
      facts({
        "chat-new": IDLE,
        "chat-old": { status: "running", unread: false, stateEnteredAt: 1 },
      }),
    )

    expect(signal?.chatId).toBe("chat-old")
    expect(signal?.tone).toBe("warning")
    expect(signal?.linkedCount).toBe(2)
  })

  test("unread output counts as something to say", () => {
    const signal = cardChatSignal(["chat-1"], facts({ "chat-1": { status: "idle", unread: true } }))
    expect(signal?.tone).toBe("success")
    expect(signal?.label).toBe("Unread")
  })
})
