import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { KannaBoard } from "./KannaBoard"
import { EMPTY_CHAT_ACTIVITY } from "../../../shared/types"
import type { BoardChatFacts } from "../../lib/boards/boardChatFacts"
import type { BoardViewSnapshot, Card } from "../../../shared/boards/types"

/**
 * The card's status row answers one question — "is an agent working this card
 * right now" — and says nothing when the answer is no. These pin both halves:
 * the signal when there is one, and the silence when there is not, which is
 * what keeps a 200-card board readable.
 */

function card(id: string): Card {
  return {
    id,
    boardId: "b1",
    columnId: "todo",
    projectId: null,
    title: id,
    rank: "a0",
    content: {},
    // Attribution, deliberately: an agent wrote this row last. The status row
    // must key on chat LIVENESS, so this alone buys the card nothing.
    updatedBy: { kind: "agent", chatId: "chat-that-wrote-it" },
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
  }
}

function view(chatLinksByCard: Record<string, string[]>, cards: Card[]): BoardViewSnapshot {
  return {
    board: {
      id: "b1",
      ownerKind: "project",
      ownerId: "p1",
      title: "Board",
      description: null,
      templateId: null,
      cardFields: [],
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
    },
    columns: [
      { id: "todo", boardId: "b1", title: "Todo", rank: "a0", semantic: "start", colorToken: null, wipLimit: null },
    ],
    counts: { todo: cards.length },
    cards: { todo: cards },
    cursors: { todo: null },
    chatLinksByCard,
  }
}

function render(snapshot: BoardViewSnapshot, chatFacts?: Record<string, BoardChatFacts>): string {
  return renderToStaticMarkup(
    <KannaBoard
      view={snapshot}
      chatFacts={chatFacts}
      onCardMove={() => undefined}
      onColumnMove={() => undefined}
      onOpenCard={() => undefined}
      onLoadMore={() => undefined}
      onColumnSave={() => undefined}
      onColumnDelete={() => undefined}
      onColumnAdd={() => undefined}
      onCardAdd={() => undefined}
    />,
  )
}

function facts(rows: Record<string, BoardChatFacts>): Record<string, BoardChatFacts> {
  return rows
}

const QUIET: BoardChatFacts = { title: "Quiet chat", status: "idle", unread: false, activity: EMPTY_CHAT_ACTIVITY }

describe("BoardCard chat signal", () => {
  test("a running chat shows the amber dot, the word, and a ticking stamp", () => {
    const html = render(
      view({ "card-1": ["chat-1"] }, [card("card-1")]),
      facts({
        "chat-1": {
          title: "Fix login",
          status: "running",
          unread: false,
          stateEnteredAt: Date.now() - 80_000,
          activity: EMPTY_CHAT_ACTIVITY,
        },
      }),
    )

    expect(html).toContain("bg-warning")
    expect(html).toContain("Running")
    // tabular-nums so the ticker cannot reflow the card underneath it.
    expect(html).toMatch(/tabular-nums[^>]*>1:20</u)
  })

  /** Colour never carries the meaning alone, and a dot never pulses. */
  test("the signal is never colour alone, and never animates", () => {
    const html = render(
      view({ "card-1": ["chat-1"] }, [card("card-1")]),
      facts({ "chat-1": { title: "Fix login", status: "failed", unread: false, activity: EMPTY_CHAT_ACTIVITY } }),
    )

    expect(html).toContain("bg-destructive")
    expect(html).toContain("Failed")
    expect(html).not.toContain("animate-pulse")
  })

  test("quiet chats read as a count, with no tone", () => {
    const html = render(
      view({ "card-1": ["chat-1", "chat-2"] }, [card("card-1")]),
      facts({ "chat-1": QUIET, "chat-2": QUIET }),
    )

    expect(html).toContain("2 chats")
    expect(html).not.toContain("bg-warning")
    expect(html).not.toContain("bg-success")
  })

  /** Silence is the healthy state: a badge on every card is noise. */
  test("a card with no linked chat renders no status row", () => {
    const html = render(view({}, [card("card-1")]), facts({}))

    expect(html).toContain("card-1")
    expect(html).not.toContain("chats")
    expect(html).not.toContain("Running")
    expect(html).not.toContain("rounded-full")
  })

  /**
   * A link is evidence, not proof — the reaper deletes chats nobody wrote to,
   * so a card can outlive its chat and must not claim one it cannot open.
   */
  test("a link to a chat that no longer exists renders no status row", () => {
    const html = render(view({ "card-1": ["gone"] }, [card("card-1")]), facts({}))

    expect(html).not.toContain("chats")
    expect(html).not.toContain("rounded-full")
  })

  /** The board is mounted without chat facts in places that only need layout. */
  test("renders without any chat facts at all", () => {
    const html = render(view({ "card-1": ["chat-1"] }, [card("card-1")]))

    expect(html).toContain("card-1")
    expect(html).not.toContain("Running")
  })
})
