/**
 * Tests for the extracted turn runner (claude-turn-runner.ts).
 * Covers the key branches of runTurn without touching agent.ts internals.
 */
import { describe, test, expect, mock } from "bun:test"
import { runTurn, type RunTurnDeps } from "./claude-turn-runner"
import type { ActiveTurn } from "./claude-session-state"
import type { HarnessTurn, HarnessEvent } from "./harness-types"
import type { TranscriptEntry } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeTurn(events: HarnessEvent[] = []): HarnessTurn {
  return {
    provider: "codex",
    stream: {
      async *[Symbol.asyncIterator]() {
        for (const event of events) {
          yield event
        }
      },
    },
    interrupt: async () => {},
    close: mock(() => {}),
  }
}

function makeErrorTurn(error: Error): HarnessTurn {
  return {
    provider: "codex",
    stream: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<HarnessEvent>> {
            return Promise.reject(error)
          },
        }
      },
    },
    interrupt: async () => {},
    close: mock(() => {}),
  }
}

function makeResultEntry(isError = false): TranscriptEntry {
  return {
    _id: "entry-1",
    createdAt: Date.now(),
    kind: "result",
    subtype: isError ? "error" : "success",
    isError,
    durationMs: 100,
    result: isError ? "Something went wrong" : "Done",
  } as TranscriptEntry
}

function makeActiveTurn(overrides: Partial<ActiveTurn> = {}, turn?: HarnessTurn): ActiveTurn {
  return {
    chatId: "chat-1",
    provider: "codex",
    turn: turn ?? makeFakeTurn(),
    model: "gpt-4o",
    planMode: false,
    status: "running",
    pendingTool: null,
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    waitStartedAt: null,
    userMessageId: null,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<RunTurnDeps> = {}): RunTurnDeps {
  const activeTurns = new Map<string, ActiveTurn>()
  const drainingStreams = new Map<string, { turn: HarnessTurn }>()

  return {
    store: {
      setSessionTokenForProvider: mock(async () => {}),
      getChat: mock(() => null),
      setPendingForkSessionToken: mock(async () => {}),
      appendMessage: mock(async () => {}),
      recordTurnFailed: mock(async () => {}),
      recordTurnFinished: mock(async () => {}),
      recordTurnCancelled: mock(async () => {}),
    } as unknown as RunTurnDeps["store"],
    activeTurns,
    drainingStreams,
    oauthPool: { release: mock(() => {}) },
    codexLimitDetector: { detect: mock(() => null) } as unknown as RunTurnDeps["codexLimitDetector"],
    handleLimitError: mock(async () => false),
    emitStateChange: mock(() => {}),
    clearDrainingStream: mock(() => {}),
    startTurnForChat: mock(async () => {}),
    maybeStartNextQueuedMessage: mock(async () => {}),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runTurn", () => {
  test("calls recordTurnFinished on successful result entry", async () => {
    const turn = makeFakeTurn([{ type: "transcript", entry: makeResultEntry(false) }])
    const active = makeActiveTurn({}, turn)
    const deps = makeDeps()

    await runTurn(deps, active)

    expect(deps.store.recordTurnFinished).toHaveBeenCalledWith("chat-1")
    expect(deps.store.recordTurnFailed).not.toHaveBeenCalled()
  })

  test("calls recordTurnFailed on error result entry", async () => {
    const turn = makeFakeTurn([{ type: "transcript", entry: makeResultEntry(true) }])
    const active = makeActiveTurn({}, turn)
    const deps = makeDeps()

    await runTurn(deps, active)

    expect(deps.store.recordTurnFailed).toHaveBeenCalledWith("chat-1", "Something went wrong")
    expect(deps.store.recordTurnFinished).not.toHaveBeenCalled()
  })

  test("sets hasFinalResult=true and moves to drainingStreams on result", async () => {
    const turn = makeFakeTurn([{ type: "transcript", entry: makeResultEntry(false) }])
    const active = makeActiveTurn({}, turn)
    const deps = makeDeps()
    deps.activeTurns.set("chat-1", active)

    await runTurn(deps, active)

    expect(active.hasFinalResult).toBe(true)
    expect(deps.activeTurns.has("chat-1")).toBe(false)
    expect(deps.drainingStreams.has("chat-1")).toBe(true)
  })

  test("records turn cancelled when cancelRequested=true and cancelRecorded=false", async () => {
    const turn = makeFakeTurn([])
    const active = makeActiveTurn({ cancelRequested: true, cancelRecorded: false }, turn)
    const deps = makeDeps()

    await runTurn(deps, active)

    expect(deps.store.recordTurnCancelled).toHaveBeenCalledWith("chat-1")
  })

  test("does not record cancelled when cancelRecorded=true", async () => {
    const turn = makeFakeTurn([])
    const active = makeActiveTurn({ cancelRequested: true, cancelRecorded: true }, turn)
    const deps = makeDeps()

    await runTurn(deps, active)

    expect(deps.store.recordTurnCancelled).not.toHaveBeenCalled()
  })

  test("releases oauthPool token and emits state change in finally", async () => {
    const turn = makeFakeTurn([])
    const active = makeActiveTurn({}, turn)
    const deps = makeDeps()

    await runTurn(deps, active)

    expect(deps.oauthPool?.release).toHaveBeenCalledWith("chat-1")
    expect(deps.emitStateChange).toHaveBeenCalledWith("chat-1")
  })

  test("calls maybeStartNextQueuedMessage after successful turn", async () => {
    const turn = makeFakeTurn([{ type: "transcript", entry: makeResultEntry(false) }])
    const active = makeActiveTurn({ postToolFollowUp: null }, turn)
    const deps = makeDeps()

    await runTurn(deps, active)

    expect(deps.maybeStartNextQueuedMessage).toHaveBeenCalledWith("chat-1")
    expect(deps.startTurnForChat).not.toHaveBeenCalled()
  })

  test("calls startTurnForChat when postToolFollowUp is set", async () => {
    const turn = makeFakeTurn([])
    const active = makeActiveTurn({
      postToolFollowUp: { content: "follow-up content", planMode: false },
    }, turn)
    const deps = makeDeps()

    await runTurn(deps, active)

    expect(deps.startTurnForChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat-1",
        content: "follow-up content",
        appendUserPrompt: false,
      })
    )
    expect(deps.maybeStartNextQueuedMessage).not.toHaveBeenCalled()
  })

  test("does not call maybeStartNextQueuedMessage when cancelRequested=true", async () => {
    const turn = makeFakeTurn([])
    const active = makeActiveTurn({ cancelRequested: true, cancelRecorded: true }, turn)
    const deps = makeDeps()

    await runTurn(deps, active)

    expect(deps.maybeStartNextQueuedMessage).not.toHaveBeenCalled()
    expect(deps.startTurnForChat).not.toHaveBeenCalled()
  })

  test("handles limit error: appends error entry and records failed", async () => {
    const errorTurn = makeErrorTurn(new Error("rate limit hit"))
    const active = makeActiveTurn({}, errorTurn)
    const deps = makeDeps({
      handleLimitError: mock(async () => false), // not a limit error
    })

    await runTurn(deps, active)

    expect(deps.store.appendMessage).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({ kind: "result", isError: true })
    )
    expect(deps.store.recordTurnFailed).toHaveBeenCalledWith("chat-1", "rate limit hit")
  })

  test("handles limit error: records rate_limit when handleLimitError returns true", async () => {
    const errorTurn = makeErrorTurn(new Error("quota exceeded"))
    const active = makeActiveTurn({}, errorTurn)
    const deps = makeDeps({
      handleLimitError: mock(async () => true), // handled as limit
    })

    await runTurn(deps, active)

    expect(deps.store.recordTurnFailed).toHaveBeenCalledWith("chat-1", "rate_limit")
    expect(deps.store.appendMessage).not.toHaveBeenCalled()
  })

  test("skips error handling when cancelRequested=true during stream error", async () => {
    const errorTurn = makeErrorTurn(new Error("cancelled mid-stream"))
    const active = makeActiveTurn({ cancelRequested: true, cancelRecorded: true }, errorTurn)
    const deps = makeDeps()

    await runTurn(deps, active)

    expect(deps.store.recordTurnFailed).not.toHaveBeenCalled()
    expect(deps.handleLimitError).not.toHaveBeenCalled()
  })

  test("processes session_token event and updates store", async () => {
    const chatRecord = {
      pendingForkSessionToken: { provider: "claude" as const, token: "old-token" },
    }
    const turn = makeFakeTurn([
      { type: "session_token" as const, sessionToken: "new-token" },
    ])
    const active = makeActiveTurn({}, turn)
    const deps = makeDeps({
      store: {
        setSessionTokenForProvider: mock(async () => {}),
        getChat: mock(() => chatRecord),
        setPendingForkSessionToken: mock(async () => {}),
        appendMessage: mock(async () => {}),
        recordTurnFailed: mock(async () => {}),
        recordTurnFinished: mock(async () => {}),
        recordTurnCancelled: mock(async () => {}),
      } as unknown as RunTurnDeps["store"],
    })

    await runTurn(deps, active)

    expect(deps.store.setSessionTokenForProvider).toHaveBeenCalledWith(
      "chat-1", "codex", "new-token"
    )
    // pendingForkSessionToken.token differs from event.sessionToken → cleared
    expect(deps.store.setPendingForkSessionToken).toHaveBeenCalledWith("chat-1", null)
  })

  test("closes the turn in finally regardless of outcome", async () => {
    const turn = makeFakeTurn([])
    const active = makeActiveTurn({}, turn)
    const deps = makeDeps()

    await runTurn(deps, active)

    expect(turn.close).toHaveBeenCalled()
  })

  test("sets active.status to running on system_init entry", async () => {
    const systemInitEntry: TranscriptEntry = {
      _id: "entry-sys",
      createdAt: Date.now(),
      kind: "system_init",
    } as TranscriptEntry
    const turn = makeFakeTurn([{ type: "transcript" as const, entry: systemInitEntry }])
    const active = makeActiveTurn({ status: "starting" as never }, turn)
    const deps = makeDeps()

    await runTurn(deps, active)

    expect(active.status).toBe("running")
  })
})
