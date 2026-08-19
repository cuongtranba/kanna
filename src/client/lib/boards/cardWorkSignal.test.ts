import { describe, expect, test } from "bun:test"
import { EMPTY_CHAT_ACTIVITY, type ChatActivity } from "../../../shared/types"
import type { ChatDotTone } from "../chatStatusIndicator"
import { cardWorkSignal, type CardChatFacts } from "./cardWorkSignal"

/**
 * The card face's third row. It exists to answer one question at a glance —
 * "what kind of work is on this card right now" — and to say nothing at all
 * when the answer is none, which is what keeps a 200-card board readable.
 *
 * The table below is ordered, and the order is the design: the row that names
 * the SHAPE of the work outranks the one that merely counts it.
 */

const NOW = 1_700_000_000_000

function facts(rows: Record<string, CardChatFacts>): Record<string, CardChatFacts> {
  return rows
}

function activity(overrides: Partial<ChatActivity> = {}): ChatActivity {
  return { ...EMPTY_CHAT_ACTIVITY, ...overrides }
}

function chat(overrides: Partial<CardChatFacts> = {}): CardChatFacts {
  return { status: "idle", unread: false, stateEnteredAt: 1_000, activity: EMPTY_CHAT_ACTIVITY, ...overrides }
}

/** One chat, one card — the shape every precedence assertion below uses. */
function signalFor(row: CardChatFacts) {
  return cardWorkSignal(["chat-1"], facts({ "chat-1": row }), NOW)
}

const IDLE: CardChatFacts = { status: "idle", unread: false, activity: EMPTY_CHAT_ACTIVITY }

/**
 * One facts object per precedence row, each satisfying its own row and none
 * above it. Adjacent pairs are merged below to prove the ORDER decides.
 */
const ROW_FACTS: readonly CardChatFacts[] = [
  // 1 — failed
  chat({ status: "failed", activity: activity({ lastFailure: { reason: "OAuth token expired" } }) }),
  // 2 — awaiting an answer
  chat({ status: "waiting_for_user", activity: activity({ awaitingAnswer: true }) }),
  // 3 — a live workflow
  chat({ status: "running", activity: activity({ workflow: { name: "release", agentCount: 3 } }) }),
  // 4 — an armed loop
  chat({ status: "running", activity: activity({ loop: { done: 5, total: 8 } }) }),
  // 5 — bare agents
  chat({ status: "running", activity: activity({ agents: 2 }) }),
  // 6 — the session itself
  chat({ status: "running", activity: activity({ backgroundTasks: 4 }) }),
  // 7 — background tasks with the session already idle again
  chat({ status: "idle", unread: true, activity: activity({ backgroundTasks: 4 }) }),
  // 8 — a cron job waiting to fire
  chat({ status: "idle", unread: true, activity: activity({ cron: { nextFireAt: NOW + 12 * 60_000, paused: false } }) }),
  // 9 — unread output
  chat({ status: "idle", unread: true }),
  // 10 — nothing at all
  chat(),
]

const EXPECTED_ROWS: readonly { tone: ChatDotTone | null; label: string }[] = [
  { tone: "destructive", label: "agent failed — OAuth token expired" },
  { tone: "info", label: "waiting for you" },
  { tone: "warning", label: "release · 3 agents" },
  { tone: "warning", label: "loop · 5/8" },
  { tone: "warning", label: "2 agents" },
  { tone: "warning", label: "running" },
  { tone: "warning", label: "4 background tasks" },
  { tone: "muted", label: "runs in 12m" },
  { tone: "success", label: "unread" },
  { tone: null, label: "1 chat" },
]

/**
 * Rows 3–7 name work in flight, so they carry the elapsed stamp. Row 2 does
 * too — a question you have not answered is still open. Rows 1 and 8 must not:
 * a failure is not a duration and a countdown is not an elapsed time.
 */
const TICKING_ROWS = new Set([2, 3, 4, 5, 6, 7])

describe("cardWorkSignal precedence table", () => {
  ROW_FACTS.forEach((row, index) => {
    const number = index + 1
    const expected = EXPECTED_ROWS[index]
    test(`row ${String(number)} reads "${expected?.label ?? ""}"`, () => {
      const signal = signalFor(row)
      expect(signal?.tone ?? null).toBe(expected?.tone ?? null)
      expect(signal?.label).toBe(expected?.label ?? "")
    })
  })

  /**
   * Adjacent-pair coverage: a facts object satisfying BOTH rows must speak the
   * higher one. Field-wise union rather than a spread — a spread of the higher
   * row's activity would carry its own zero values over the lower row's real
   * ones, and the pair would never actually overlap.
   */
  ROW_FACTS.slice(0, -1).forEach((higher, index) => {
    const lower = ROW_FACTS[index + 1]
    if (!lower) return
    test(`row ${String(index + 1)} outranks row ${String(index + 2)}`, () => {
      const merged: CardChatFacts = {
        ...higher,
        unread: higher.unread || lower.unread,
        activity: {
          agents: higher.activity.agents || lower.activity.agents,
          workflow: higher.activity.workflow ?? lower.activity.workflow,
          loop: higher.activity.loop ?? lower.activity.loop,
          backgroundTasks: higher.activity.backgroundTasks || lower.activity.backgroundTasks,
          cron: higher.activity.cron ?? lower.activity.cron,
          awaitingAnswer: higher.activity.awaitingAnswer || lower.activity.awaitingAnswer,
          lastFailure: higher.activity.lastFailure ?? lower.activity.lastFailure,
        },
      }
      const signal = signalFor(merged)
      expect(signal?.label).toBe(EXPECTED_ROWS[index]?.label ?? "")
    })
  })

  /**
   * The strongest form of the same claim: one chat satisfying every row at once
   * still reads as the first.
   */
  test("a chat satisfying every row at once speaks row 1", () => {
    const everything: CardChatFacts = {
      status: "failed",
      unread: true,
      stateEnteredAt: 1_000,
      activity: {
        agents: 2,
        workflow: { name: "release", agentCount: 3 },
        loop: { done: 5, total: 8 },
        backgroundTasks: 4,
        cron: { nextFireAt: NOW + 60_000, paused: false },
        awaitingAnswer: true,
        lastFailure: { reason: "OAuth token expired" },
      },
    }
    const signal = signalFor(everything)
    expect(signal?.tone).toBe("destructive")
    expect(signal?.label).toBe("agent failed — OAuth token expired")
  })
})

describe("cardWorkSignal ticker", () => {
  ROW_FACTS.forEach((row, index) => {
    const number = index + 1
    test(`row ${String(number)} ${TICKING_ROWS.has(number) ? "ticks" : "does not tick"}`, () => {
      const signal = signalFor(row)
      if (TICKING_ROWS.has(number)) {
        expect(signal?.liveSince).toBe(1_000)
      } else {
        expect(signal?.liveSince).toBeNull()
      }
    })
  })

  /**
   * A ticker beside "failed" would imply the failure has not stopped, and a
   * countdown is not an elapsed time — neither row may carry one even though
   * both have a `stateEnteredAt` to draw from.
   */
  test("row 1 carries no ticker even with a state timestamp", () => {
    expect(signalFor(ROW_FACTS[0] as CardChatFacts)?.liveSince).toBeNull()
  })

  test("row 8 carries no ticker even with a state timestamp", () => {
    expect(signalFor(ROW_FACTS[7] as CardChatFacts)?.liveSince).toBeNull()
  })
})

describe("cardWorkSignal", () => {
  test("says nothing for a card with no linked chat", () => {
    expect(cardWorkSignal([], facts({}), NOW)).toBeNull()
  })

  /**
   * A link is evidence, not proof: the stale-empty-chat reaper deletes chats
   * nobody wrote to, so a card can outlive its chat. Claiming a count that
   * includes a chat the reader cannot open would be a lie.
   */
  test("ignores links whose chat no longer exists", () => {
    expect(cardWorkSignal(["gone-1", "gone-2"], facts({}), NOW)).toBeNull()
  })

  test("drops the missing links from the count but keeps the live one", () => {
    const signal = cardWorkSignal(["gone", "chat-1"], facts({ "chat-1": IDLE }), NOW)
    expect(signal?.linkedCount).toBe(1)
    expect(signal?.label).toBe("1 chat")
  })

  /** Silence is the healthy state — but the card still admits the chat exists. */
  test("quiet chats report a count and no tone", () => {
    const signal = cardWorkSignal(["chat-2", "chat-1"], facts({ "chat-1": IDLE, "chat-2": IDLE }), NOW)

    expect(signal).toEqual({
      chatId: "chat-2",
      tone: null,
      label: "2 chats",
      linkedCount: 2,
      liveSince: null,
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
      facts({ "chat-new": IDLE, "chat-old": chat({ status: "running" }) }),
      NOW,
    )

    expect(signal?.chatId).toBe("chat-old")
    expect(signal?.label).toBe("running")
    expect(signal?.linkedCount).toBe(2)
  })

  test("a paused cron job says nothing — it is not scheduled work", () => {
    const signal = signalFor(chat({ activity: activity({ cron: { nextFireAt: NOW + 60_000, paused: true } }) }))
    expect(signal?.tone).toBeNull()
    expect(signal?.label).toBe("1 chat")
  })

  /** Never a dangling em dash: a failure with no reason still reads cleanly. */
  test("a failure with no reason degrades to the bare label", () => {
    expect(signalFor(chat({ status: "failed" }))?.label).toBe("agent failed")
  })

  test("a blank reason is treated as no reason", () => {
    const signal = signalFor(chat({ status: "failed", activity: activity({ lastFailure: { reason: "   " } }) }))
    expect(signal?.label).toBe("agent failed")
  })

  /** A run that failed while the chat's own status never went red still speaks. */
  test("a recorded failure fires row 1 even when the status is idle", () => {
    const signal = signalFor(chat({ activity: activity({ lastFailure: { reason: "exit 1" } }) }))
    expect(signal?.tone).toBe("destructive")
    expect(signal?.label).toBe("agent failed — exit 1")
  })

  test("counts read singular at one", () => {
    expect(signalFor(chat({ activity: activity({ agents: 1 }) }))?.label).toBe("1 agent")
    expect(signalFor(chat({ activity: activity({ backgroundTasks: 1 }) }))?.label).toBe("1 background task")
    expect(signalFor(chat({ activity: activity({ workflow: { name: "wf", agentCount: 1 } }) }))?.label)
      .toBe("wf · 1 agent")
  })

  /** A workflow with no name is still a workflow; the row must not read " · 3 agents". */
  test("an unnamed workflow falls back to the word", () => {
    const signal = signalFor(chat({ activity: activity({ workflow: { name: null, agentCount: 3 } }) }))
    expect(signal?.label).toBe("workflow · 3 agents")
  })

  test("a starting session reads as running", () => {
    expect(signalFor(chat({ status: "starting" }))?.label).toBe("running")
  })

  /** A cron whose next fire is unknown says it is scheduled, not "runs in NaN". */
  test("a cron with no next fire reads as scheduled", () => {
    const signal = signalFor(chat({ activity: activity({ cron: { nextFireAt: null, paused: false } }) }))
    expect(signal?.tone).toBe("muted")
    expect(signal?.label).toBe("scheduled")
  })

  test("a cron already past its fire time reads as due", () => {
    const signal = signalFor(chat({ activity: activity({ cron: { nextFireAt: NOW - 1_000, paused: false } }) }))
    expect(signal?.label).toBe("due now")
  })

  /** Scheduled work is not running work: amber means attention available. */
  test("row 8 is muted, never amber", () => {
    const signal = signalFor(ROW_FACTS[7] as CardChatFacts)
    expect(signal?.tone).toBe("muted")
    expect(signal?.tone).not.toBe("warning")
  })
})
