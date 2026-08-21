/**
 * The compaction seam: what `runTurn` writes for a Codex summarize turn is
 * what `buildHistoryPrimer` reads to build the next turn's context.
 *
 * These two are wired only through the transcript, so nothing in either unit
 * suite catches an ordering mistake between them — and getting the order wrong
 * is silent: the compaction spends a full turn and hands Codex nothing.
 */

import { describe, test, expect, mock } from "bun:test"
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
    close: mock(() => {}),
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
      setSessionTokenForProvider: mock(async () => {}),
      getChat: mock(() => null),
      setPendingForkSessionToken: mock(async () => {}),
      appendMessage: mock(async (_chatId: string, e: TranscriptEntry) => { transcript.push(e) }),
      recordTurnFailed: mock(async () => {}),
      recordTurnFinished: mock(async () => {}),
      recordTurnCancelled: mock(async () => {}),
    } as unknown as RunTurnDeps["store"],
    activeTurns: new Map(),
    drainingStreams: new Map(),
    oauthPool: null,
    codexLimitDetector: { detect: mock(() => null) } as unknown as RunTurnDeps["codexLimitDetector"],
    handleLimitError: mock(async () => false),
    emitStateChange: mock(() => {}),
    clearDrainingStream: mock(() => {}),
    startTurnForChat: mock(async () => {}),
    maybeStartNextQueuedMessage: mock(async () => {}),
    stopCodexSession: mock(() => {}),
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
