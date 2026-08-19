import { describe, expect, test } from "bun:test"
import { EMPTY_CHAT_ACTIVITY, type ChatActivity } from "../../../shared/types"
import { cardWorkSignal, type CardChatFacts } from "./cardWorkSignal"

/**
 * The card face's third row. It exists to answer one question at a glance —
 * "what is working this card right now" — and to say nothing at all when the
 * answer is nothing, which is what keeps a 200-card board readable.
 *
 * The precedence table is the whole design, so it is tested the way it is
 * written: each row is asserted to beat every row below it.
 */

function facts(rows: Record<string, CardChatFacts>): Record<string, CardChatFacts> {
  return rows
}

function chat(activity: Partial<ChatActivity>, over: Partial<CardChatFacts> = {}): CardChatFacts {
  return {
    status: "idle",
    unread: false,
    stateEnteredAt: 1_000,
    activity: { ...EMPTY_CHAT_ACTIVITY, ...activity },
    ...over,
  }
}

const IDLE: CardChatFacts = { status: "idle", unread: false, activity: EMPTY_CHAT_ACTIVITY }

/**
 * Every row of the table, richest first, each carrying the inputs of every row
 * below it. Walking the list and asserting the head wins proves precedence
 * exhaustively rather than one pair at a time.
 */
const ROWS: readonly { name: string; chat: CardChatFacts; tone: string | null; label: string }[] = [
  {
    name: "1 · session failed",
    chat: chat({ agents: 2 }, { status: "failed" }),
    tone: "destructive",
    label: "Failed",
  },
  {
    name: "1 · last run failed",
    chat: chat({ lastRunFailure: { code: "TIMEOUT" }, backgroundTasks: 3 }),
    tone: "destructive",
    label: "Agent failed — TIMEOUT",
  },
  {
    name: "2 · waiting for you",
    chat: chat({ awaitingAnswer: true, workflow: { name: "audit", agentCount: 4 }, agents: 2 }),
    tone: "info",
    label: "Waiting",
  },
  {
    name: "3 · workflow",
    chat: chat({ workflow: { name: "audit", agentCount: 4 }, loop: { done: 5, total: 8 }, agents: 2 }),
    tone: "warning",
    label: "audit · 4 agents",
  },
  {
    name: "4 · loop",
    chat: chat({ loop: { done: 5, total: 8 }, agents: 2 }, { status: "running" }),
    tone: "warning",
    label: "Loop · 5/8",
  },
  {
    name: "5 · agents",
    chat: chat({ agents: 2, backgroundTasks: 3 }, { status: "running" }),
    tone: "warning",
    label: "2 agents",
  },
  {
    name: "6 · session running",
    chat: chat({ backgroundTasks: 3 }, { status: "running" }),
    tone: "warning",
    label: "Running",
  },
  {
    name: "7 · background tasks",
    chat: chat({ backgroundTasks: 3, cron: { nextFireAt: 2_000, paused: false } }),
    tone: "warning",
    label: "3 background tasks",
  },
  {
    name: "8 · cron",
    chat: chat({ cron: { nextFireAt: 2_000, paused: false } }, { unread: true }),
    tone: "muted",
    label: "Runs in",
  },
  {
    name: "9 · unread",
    chat: chat({}, { unread: true }),
    tone: "success",
    label: "Unread",
  },
  {
    name: "10 · quiet",
    chat: IDLE,
    tone: null,
    label: "1 chat",
  },
]

describe("cardWorkSignal precedence", () => {
  for (const row of ROWS) {
    test(`${row.name} reads as ${row.tone ?? "no tone"}`, () => {
      const signal = cardWorkSignal(["c"], facts({ c: row.chat }))
      expect(signal?.tone).toBe(row.tone as never)
      expect(signal?.label).toBe(row.label)
    })
  }

  /**
   * The table's ordering claim, stated once over the whole list: each row's
   * inputs already include the lower rows', so winning here IS the precedence.
   */
  test("no row is ever answered by a row beneath it", () => {
    const answered = ROWS.map((row) => cardWorkSignal(["c"], facts({ c: row.chat }))?.label)
    expect(answered).toEqual(ROWS.map((row) => row.label))
  })
})

describe("cardWorkSignal clock", () => {
  /**
   * A ticker beside "failed" would imply it has not stopped, and a countdown
   * is not an elapsed time — so the two are different shapes, not one nullable
   * timestamp that the renderer has to guess the direction of.
   */
  test("a failure carries no clock at all", () => {
    const signal = cardWorkSignal(["c"], facts({ c: chat({}, { status: "failed" }) }))
    expect(signal?.clock).toBeNull()
  })

  test("a scheduled run counts down, it does not count up", () => {
    const signal = cardWorkSignal(["c"], facts({ c: chat({ cron: { nextFireAt: 9_000, paused: false } }) }))
    expect(signal?.clock).toEqual({ kind: "countdown", until: 9_000 })
  })

  test("live work counts up from the moment the chat entered its state", () => {
    const signal = cardWorkSignal(["c"], facts({ c: chat({ agents: 2 }, { stateEnteredAt: 40 }) }))
    expect(signal?.clock).toEqual({ kind: "elapsed", since: 40 })
  })

  /** Kept deliberately: it says how long the chat has been blocked on a reply. */
  test("waiting for you keeps its elapsed ticker", () => {
    const signal = cardWorkSignal(
      ["c"],
      facts({ c: chat({ awaitingAnswer: true }, { stateEnteredAt: 40 }) }),
    )
    expect(signal?.clock).toEqual({ kind: "elapsed", since: 40 })
  })

  test("unread and a bare count are not durations", () => {
    expect(cardWorkSignal(["c"], facts({ c: chat({}, { unread: true }) }))?.clock).toBeNull()
    expect(cardWorkSignal(["c"], facts({ c: IDLE }))?.clock).toBeNull()
  })

  /** A chat whose state change was never stamped still reports its work. */
  test("live work with no timestamp reports the work and no clock", () => {
    const signal = cardWorkSignal(["c"], facts({ c: { status: "running", unread: false, activity: EMPTY_CHAT_ACTIVITY } }))
    expect(signal?.label).toBe("Running")
    expect(signal?.clock).toBeNull()
  })
})

describe("cardWorkSignal wording", () => {
  test("counts are singular at one", () => {
    expect(cardWorkSignal(["c"], facts({ c: chat({ agents: 1 }) }))?.label).toBe("1 agent")
    expect(cardWorkSignal(["c"], facts({ c: chat({ backgroundTasks: 1 }) }))?.label).toBe("1 background task")
    expect(cardWorkSignal(["c"], facts({ c: IDLE }))?.label).toBe("1 chat")
  })

  test("an unnamed workflow still names its shape", () => {
    const signal = cardWorkSignal(["c"], facts({ c: chat({ workflow: { name: null, agentCount: 1 } }) }))
    expect(signal?.label).toBe("Workflow · 1 agent")
  })

  /** No code is better than a fabricated one; the row still says it failed. */
  test("a failure with no code says only that it failed", () => {
    const signal = cardWorkSignal(["c"], facts({ c: chat({ lastRunFailure: { code: null } }) }))
    expect(signal?.label).toBe("Agent failed")
  })

  /**
   * A paused job is not scheduled work — it is a job someone switched off, and
   * saying "runs in …" about it would be false.
   */
  test("a paused cron job says nothing", () => {
    const signal = cardWorkSignal(["c"], facts({ c: chat({ cron: { nextFireAt: 2_000, paused: true } }) }))
    expect(signal?.tone).toBeNull()
    expect(signal?.label).toBe("1 chat")
  })

  /** Armed with no computable next fire: still scheduled, just not countable. */
  test("a cron job with no next fire is scheduled without a countdown", () => {
    const signal = cardWorkSignal(["c"], facts({ c: chat({ cron: { nextFireAt: null, paused: false } }) }))
    expect(signal?.label).toBe("Scheduled")
    expect(signal?.clock).toBeNull()
  })
})

describe("cardWorkSignal chat selection", () => {
  test("says nothing for a card with no linked chat", () => {
    expect(cardWorkSignal([], facts({}))).toBeNull()
  })

  /**
   * A link is evidence, not proof: the stale-empty-chat reaper deletes chats
   * nobody wrote to, so a card can outlive its chat. Claiming a count that
   * includes a chat the reader cannot open would be a lie.
   */
  test("ignores links whose chat no longer exists", () => {
    expect(cardWorkSignal(["gone-1", "gone-2"], facts({}))).toBeNull()
  })

  test("quiet chats report a count and no tone", () => {
    const signal = cardWorkSignal(["chat-2", "chat-1"], facts({ "chat-1": IDLE, "chat-2": IDLE }))

    expect(signal).toEqual({
      chatId: "chat-2",
      tone: null,
      label: "2 chats",
      linkedCount: 2,
      clock: null,
    })
  })

  /**
   * Newest first, the same rule `deriveStartWorkStatus` picks a card's live
   * chat by — so the drawer's button and the card's dot cannot disagree about
   * which chat the card is "on".
   */
  test("takes the newest chat that has something to say", () => {
    const signal = cardWorkSignal(
      ["chat-new", "chat-old"],
      facts({ "chat-new": IDLE, "chat-old": chat({ agents: 1 }) }),
    )

    expect(signal?.chatId).toBe("chat-old")
    expect(signal?.label).toBe("1 agent")
    expect(signal?.linkedCount).toBe(2)
  })
})
