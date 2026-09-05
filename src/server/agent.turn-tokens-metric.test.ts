import { afterEach, describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import { TURN_COST_USD, TURN_TOKENS } from "./observability"
import { startMetricRecorder, type MetricRecorder } from "./test-helpers/metric-recorder"
import type { ActiveTurn } from "./claude-session-state"
import type { HarnessTurn } from "./harness-types"


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

function activeTurn(over: Partial<ActiveTurn>): ActiveTurn {
  return {
    chatId: "chat-1",
    provider: "claude",
    turn: {} as HarnessTurn,
    startedAt: Date.now() - 1_000,
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

describe("kanna.turn.tokens", () => {
  let recorder: MetricRecorder | null = null

  afterEach(async () => {
    await recorder?.dispose()
    recorder = null
  })

  test("splits the turn's tokens by kind, tagged with provider and model", async () => {
    recorder = startMetricRecorder()
    const store: TerminalStore = { onTurnTerminal: null }
    const coordinator = buildCoordinator(store)
    coordinator.getActiveTurnMap().set("chat-1", activeTurn({
      usage: { inputTokens: 1_000, cachedInputTokens: 400, outputTokens: 250 },
    }))

    store.onTurnTerminal?.("chat-1", "finished")

    const byKind = new Map(
      (await recorder.counter(TURN_TOKENS)).map((p) => [p.attributes.kind, p]),
    )
    expect(byKind.get("input")?.value).toBe(600)
    expect(byKind.get("cached_input")?.value).toBe(400)
    expect(byKind.get("output")?.value).toBe(250)
    expect(byKind.get("output")?.attributes).toEqual({
      provider: "claude",
      model: "claude-opus-5",
      kind: "output",
    })
  })

  test("the recorded kinds sum to the tokens actually billed", async () => {
    recorder = startMetricRecorder()
    const store: TerminalStore = { onTurnTerminal: null }
    const coordinator = buildCoordinator(store)
    coordinator.getActiveTurnMap().set("chat-1", activeTurn({
      usage: { inputTokens: 900, cachedInputTokens: 400, outputTokens: 100 },
    }))

    store.onTurnTerminal?.("chat-1", "finished")

    const total = (await recorder.counter(TURN_TOKENS)).reduce((sum, p) => sum + p.value, 0)
    expect(total).toBe(1_000)
  })

  test("records the provider's cost when it reported one", async () => {
    recorder = startMetricRecorder()
    const store: TerminalStore = { onTurnTerminal: null }
    const coordinator = buildCoordinator(store)
    coordinator.getActiveTurnMap().set("chat-1", activeTurn({
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.25 },
    }))

    store.onTurnTerminal?.("chat-1", "finished")

    const [point] = await recorder.counter(TURN_COST_USD)
    expect(point?.value).toBeCloseTo(0.25, 6)
    expect(point?.attributes).toEqual({ provider: "claude", model: "claude-opus-5" })
  })

  test("records no cost point when the provider reported none", async () => {
    recorder = startMetricRecorder()
    const store: TerminalStore = { onTurnTerminal: null }
    const coordinator = buildCoordinator(store)
    coordinator.getActiveTurnMap().set("chat-1", activeTurn({
      usage: { inputTokens: 10, outputTokens: 5 },
    }))

    store.onTurnTerminal?.("chat-1", "finished")

    expect(await recorder.counter(TURN_COST_USD)).toEqual([])
  })

  test("records nothing when the turn carried no usage", async () => {
    recorder = startMetricRecorder()
    const store: TerminalStore = { onTurnTerminal: null }
    const coordinator = buildCoordinator(store)
    coordinator.getActiveTurnMap().set("chat-1", activeTurn({}))

    store.onTurnTerminal?.("chat-1", "cancelled")

    expect(await recorder.counter(TURN_TOKENS)).toEqual([])
  })

  test("records nothing when no turn is active", async () => {
    recorder = startMetricRecorder()
    const store: TerminalStore = { onTurnTerminal: null }
    buildCoordinator(store)

    store.onTurnTerminal?.("chat-unknown", "finished")

    expect(await recorder.counter(TURN_TOKENS)).toEqual([])
  })
})
