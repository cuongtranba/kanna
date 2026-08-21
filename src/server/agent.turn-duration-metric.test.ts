import { afterEach, describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import { TURN_DURATION_MS } from "./observability"
import { startMetricRecorder, type MetricRecorder } from "./test-helpers/metric-recorder"
import type { ActiveTurn } from "./claude-session-state"
import type { HarnessTurn } from "./harness-types"

// The turn-duration histogram is recorded from the store's turn-terminal
// observer — the one choke point every provider path funnels through. These
// tests drive that observer directly: no session is spawned, because what is
// under test is the enrichment (duration + provider/model off the ActiveTurn),
// not the turn machinery around it.

interface TerminalStore {
  onTurnTerminal:
    | ((chatId: string, outcome: "finished" | "failed" | "cancelled", error?: string) => void)
    | null
  runningSubagentRuns?: () => never[]
}

function buildCoordinator(store: TerminalStore) {
  store.runningSubagentRuns = () => []
  return new AgentCoordinator({
    store: store as never,
    onStateChange: () => {},
    startClaudeSession: async () => {
      throw new Error("no session should be spawned in these tests")
    },
  } as never)
}

function activeTurn(over: Partial<ActiveTurn> & { startedAt: number }): ActiveTurn {
  return {
    chatId: "chat-1",
    provider: "claude",
    turn: {} as HarnessTurn,
    model: "claude-opus-5",
    planMode: false,
    status: "running",
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    waitStartedAt: null,
    userMessageId: null,
    ...over,
  }
}

describe("kanna.turn.duration_ms", () => {
  let recorder: MetricRecorder | null = null

  afterEach(async () => {
    await recorder?.dispose()
    recorder = null
  })

  test("records the turn's wall clock with provider, model and outcome", async () => {
    recorder = startMetricRecorder()
    const store: TerminalStore = { onTurnTerminal: null }
    const coordinator = buildCoordinator(store)
    coordinator.activeTurns.set("chat-1", activeTurn({ startedAt: Date.now() - 5_000 }))

    store.onTurnTerminal?.("chat-1", "finished")

    const [point] = await recorder.histogram(TURN_DURATION_MS)
    expect(point?.count).toBe(1)
    expect(point?.sum).toBeGreaterThanOrEqual(5_000)
    expect(point?.sum).toBeLessThan(15_000)
    expect(point?.attributes).toEqual({
      provider: "claude",
      model: "claude-opus-5",
      outcome: "finished",
    })
  })

  test("separates outcomes so a failure rate can be derived from the same metric", async () => {
    recorder = startMetricRecorder()
    const store: TerminalStore = { onTurnTerminal: null }
    const coordinator = buildCoordinator(store)

    coordinator.activeTurns.set("chat-1", activeTurn({ startedAt: Date.now() - 1_000 }))
    store.onTurnTerminal?.("chat-1", "finished")
    coordinator.activeTurns.set("chat-2", activeTurn({ chatId: "chat-2", startedAt: Date.now() - 1_000 }))
    store.onTurnTerminal?.("chat-2", "failed")

    const outcomes = (await recorder.histogram(TURN_DURATION_MS))
      .map((p) => p.attributes.outcome)
      .sort()
    expect(outcomes).toEqual(["failed", "finished"])
  })

  // A background-task self-wake streams entries with no ActiveTurn registered.
  // It is not a Kanna turn and has no start time, so it must record nothing
  // rather than a fabricated duration.
  test("records nothing when no turn is active", async () => {
    recorder = startMetricRecorder()
    const store: TerminalStore = { onTurnTerminal: null }
    buildCoordinator(store)

    store.onTurnTerminal?.("chat-unknown", "finished")

    expect(await recorder.histogram(TURN_DURATION_MS)).toEqual([])
  })
})
