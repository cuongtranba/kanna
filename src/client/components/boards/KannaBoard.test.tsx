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

function card(id: string, overrides?: Partial<Card>): Card {
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
    ...overrides,
  }
}

function view(chatLinksByCard: Record<string, string[]>, cards: Card[], newSince: number | null = null): BoardViewSnapshot {
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
    newSince,
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
      onMoveToTop={() => undefined}
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
  })

  /**
   * A link is evidence, not proof — the reaper deletes chats nobody wrote to,
   * so a card can outlive its chat and must not claim one it cannot open.
   */
  test("a link to a chat that no longer exists renders no status row", () => {
    const html = render(view({ "card-1": ["gone"] }, [card("card-1")]), facts({}))

    expect(html).not.toContain("chats")
  })

  /** The board is mounted without chat facts in places that only need layout. */
  test("renders without any chat facts at all", () => {
    const html = render(view({ "card-1": ["chat-1"] }, [card("card-1")]))

    expect(html).toContain("card-1")
    expect(html).not.toContain("Running")
  })

  function withActivity(activity: Partial<BoardChatFacts["activity"]>, status: "idle" | "running" = "idle") {
    return facts({
      "chat-1": {
        title: "Fix login",
        status,
        unread: false,
        stateEnteredAt: Date.now() - 80_000,
        activity: { ...EMPTY_CHAT_ACTIVITY, ...activity },
      },
    })
  }

  test("a live workflow names itself and its agent count over a bare session", () => {
    const html = render(
      view({ "card-1": ["chat-1"] }, [card("card-1")]),
      withActivity({ workflow: { name: "audit", agentCount: 4 } }, "running"),
    )

    expect(html).toContain("audit · 4 agents")
    expect(html).not.toContain("Running")
  })

  test("a loop outranks the agent running its chunk", () => {
    const html = render(
      view({ "card-1": ["chat-1"] }, [card("card-1")]),
      withActivity({ loop: { done: 5, total: 8 }, agents: 1 }, "running"),
    )

    expect(html).toContain("Loop · 5/8")
  })

  test("an armed cron job reads muted and counts down to its next fire", () => {
    const html = render(
      view({ "card-1": ["chat-1"] }, [card("card-1")]),
      withActivity({ cron: { nextFireAt: Date.now() + 12 * 60_000, paused: false } }),
    )

    expect(html).toContain("bg-muted-foreground")
    expect(html).toContain("Runs in")
    expect(html).toMatch(/tabular-nums[^>]*>12m</u)
    expect(html).not.toContain("bg-warning")
  })

  test("a failed background agent turns the card destructive and names the code", () => {
    const html = render(
      view({ "card-1": ["chat-1"] }, [card("card-1")]),
      withActivity({ lastRunFailure: { code: "TIMEOUT" } }),
    )

    expect(html).toContain("bg-destructive")
    expect(html).toContain("<span>Agent failed — TIMEOUT</span></span>")
  })
})

describe("new-issue marker", () => {
  test("shows · N new in the column header when newSince is set and there are new cards", () => {
    const cards = [
      card("old", { createdAt: 500 }),
      card("new1", { createdAt: 1001 }),
      card("new2", { createdAt: 2000 }),
    ]
    const html = render(view({}, cards, 1000))

    expect(html).toContain("· 2 new")
  })

  test("does not show the new suffix when newSince is null", () => {
    const html = render(view({}, [card("card-1")], null))

    expect(html).not.toContain("new")
  })

  test("does not show the new suffix when no cards are new", () => {
    const cards = [card("old", { createdAt: 500 })]
    const html = render(view({}, cards, 1000))

    expect(html).not.toContain("new")
  })

  test("new cards show a New marker", () => {
    const cards = [card("new1", { createdAt: 1001 })]
    const html = render(view({}, cards, 1000))

    expect(html).toContain("New")
    expect(html).toContain("bg-info")
  })

  test("old cards do not show the New marker", () => {
    const cards = [card("old", { createdAt: 500 })]
    const html = render(view({}, cards, 1000))

    expect(html).not.toContain(">New<")
  })
})

describe("column renders stably at 400 cards", () => {
  test("renders 400 cards without throwing", () => {
    const cards = Array.from({ length: 400 }, (_, i) => card(`card-${i}`))
    expect(() => render(view({}, cards))).not.toThrow()
  })

  test("all 400 card titles appear in the output", () => {
    const cards = Array.from({ length: 400 }, (_, i) => card(`card-${i}`))
    const html = render(view({}, cards))
    expect(html).toContain("card-0")
    expect(html).toContain("card-399")
  })
})
