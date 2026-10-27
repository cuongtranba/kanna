
import { describe, test, expect, vi } from "vite-plus/test"
import { runTurn, type RunTurnDeps } from "./claude-turn-runner"
import { buildHistoryPrimer } from "./history-primer"
import type { ActiveTurn } from "./claude-session-state"
import type { HarnessEvent, HarnessTurn } from "./harness-types"
import type { AgentProvider, TranscriptEntry } from "../shared/types"

function entry(partial: Partial<TranscriptEntry> & { kind: string }): TranscriptEntry {
  return { _id: crypto.randomUUID(), createdAt: Date.now(), ...partial } as TranscriptEntry
}

function streamOf(events: HarnessEvent[]): HarnessTurn {
  return {
    provider: "codex",
    stream: {
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event
      },
    },
    interrupt: async () => {},
    close: vi.fn(() => {}),
  }
}

async function runSummarizeTurn(history: TranscriptEntry[], summaryChunks: string[]) {
  const transcript = [...history]
  const turn = streamOf([
    ...summaryChunks.map((text) => ({
      type: "transcript" as const,
      entry: entry({ kind: "assistant_text", text }),
    })),
    {
      type: "transcript" as const,
      entry: entry({
        kind: "result",
        subtype: "success",
        isError: false,
        durationMs: 1,
        result: "Done",
      }),
    },
  ])

  const active: ActiveTurn = {
    chatId: "chat-1",
    provider: "codex",
    turn,
    startedAt: Date.now(),
    model: "gpt-5.4",
    planMode: false,
    status: "running",
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    waitStartedAt: null,
    userMessageId: null,
    compactionTurn: "codex_summary",
  }

  const deps: RunTurnDeps = {
    store: {
      setSessionTokenForProvider: vi.fn(async () => {}),
      getChat: vi.fn(() => null),
      setPendingForkSessionToken: vi.fn(async () => {}),
      appendMessage: vi.fn(async (_chatId: string, e: TranscriptEntry) => { transcript.push(e) }),
      recordTurnFailed: vi.fn(async () => {}),
      recordTurnFinished: vi.fn(async () => {}),
      recordTurnCancelled: vi.fn(async () => {}),
    } as unknown as RunTurnDeps["store"],
    activeTurns: new Map(),
    drainingStreams: new Map(),
    oauthPool: null,
    codexLimitDetector: { detect: vi.fn(() => null) } as unknown as RunTurnDeps["codexLimitDetector"],
    handleLimitError: vi.fn(async () => false),
    emitStateChange: vi.fn(() => {}),
    clearDrainingStream: vi.fn(() => {}),
    startTurnForChat: vi.fn(async () => {}),
    maybeStartNextQueuedMessage: vi.fn(async () => {}),
    stopCodexSession: vi.fn(() => {}),
  }

  await runTurn(deps, active)
  return transcript
}

describe("codex /compact → next turn's context", () => {
  const history: TranscriptEntry[] = [
    entry({ kind: "user_prompt", content: "port the auth module" }),
    entry({ kind: "assistant_text", text: "SECRET_EARLIER_DETAIL" }),
  ]

  test("the next turn is primed from the summary, not the compacted history", async () => {
    const transcript = await runSummarizeTurn(history, ["THE_CARRIED_SUMMARY"])

    const primer = buildHistoryPrimer(transcript, "codex" as AgentProvider, "keep going")

    expect(primer).not.toBeNull()
    expect(primer).toContain("THE_CARRIED_SUMMARY")
    expect(primer).not.toContain("SECRET_EARLIER_DETAIL")
    expect(primer!.endsWith("keep going")).toBe(true)
  })

  test("a compaction that produced no summary leaves the history intact", async () => {
    const transcript = await runSummarizeTurn(history, [])

    const primer = buildHistoryPrimer(transcript, "codex" as AgentProvider, "keep going")

    expect(primer).toContain("SECRET_EARLIER_DETAIL")
  })
})
