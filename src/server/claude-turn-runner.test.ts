import { describe, test, expect, mock } from "bun:test"
import { runTurn, type RunTurnDeps } from "./claude-turn-runner"
import type { ActiveTurn } from "./claude-session-state"
import type { HarnessTurn, HarnessEvent } from "./harness-types"
import type { TranscriptEntry } from "../shared/types"


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
    startedAt: Date.now(),
    model: "gpt-4o",
    planMode: false,
    status: "running",
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
    stopCodexSession: mock(() => {}),
    ...overrides,
  }
}


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
      handleLimitError: mock(async () => false),
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
      handleLimitError: mock(async () => true),
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


describe("runTurn — codex summarize turn", () => {
  function makeAssistantEntry(id: string, text: string): TranscriptEntry {
    return {
      _id: id,
      createdAt: Date.now(),
      kind: "assistant_text",
      text,
    } as TranscriptEntry
  }

  function summarizeHarness(options: {
    events: HarnessEvent[]
    compactionTurn?: ActiveTurn["compactionTurn"]
    cancelRequested?: boolean
  }) {
    const appended: TranscriptEntry[] = []
    const tokenWrites: Array<{ provider: string; token: string | null }> = []
    const stoppedCodexChatIds: string[] = []

    const turn = makeFakeTurn(options.events)
    const active = makeActiveTurn(
      {
        compactionTurn: "compactionTurn" in options ? options.compactionTurn : "codex_summary",
        cancelRequested: options.cancelRequested ?? false,
      },
      turn,
    )
    const deps = makeDeps({
      store: {
        ...makeDeps().store,
        appendMessage: mock(async (_chatId: string, entry: TranscriptEntry) => { appended.push(entry) }),
        setSessionTokenForProvider: mock(async (_chatId: string, provider: string, token: string | null) => {
          tokenWrites.push({ provider, token })
        }),
      } as unknown as RunTurnDeps["store"],
      stopCodexSession: (chatId: string) => { stoppedCodexChatIds.push(chatId) },
    })

    return { active, deps, appended, tokenWrites, stoppedCodexChatIds }
  }

  test("suppresses assistant_text and emits one joined compact_summary", async () => {
    const h = summarizeHarness({
      events: [
        { type: "transcript", entry: makeAssistantEntry("a1", "first half.") },
        { type: "transcript", entry: makeAssistantEntry("a2", "second half.") },
        { type: "transcript", entry: makeResultEntry(false) },
      ],
    })

    await runTurn(h.deps, h.active)

    expect(h.appended.filter((e) => e.kind === "assistant_text")).toEqual([])
    const summaries = h.appended.filter((e) => e.kind === "compact_summary")
    expect(summaries).toHaveLength(1)
    expect((summaries[0] as { summary: string }).summary).toBe("first half.\n\nsecond half.")
  })

  test("appends compact_boundary BEFORE compact_summary so the primer keeps the summary", async () => {
    const h = summarizeHarness({
      events: [
        { type: "transcript", entry: makeAssistantEntry("a1", "the summary") },
        { type: "transcript", entry: makeResultEntry(false) },
      ],
    })

    await runTurn(h.deps, h.active)

    const kinds = h.appended.map((e) => e.kind)
    expect(kinds.indexOf("compact_boundary")).toBeGreaterThanOrEqual(0)
    expect(kinds.indexOf("compact_boundary")).toBeLessThan(kinds.indexOf("compact_summary"))
  })

  test("clears the codex token and stops the codex session on success", async () => {
    const h = summarizeHarness({
      events: [
        { type: "transcript", entry: makeAssistantEntry("a1", "the summary") },
        { type: "transcript", entry: makeResultEntry(false) },
      ],
    })

    await runTurn(h.deps, h.active)

    expect(h.tokenWrites).toContainEqual({ provider: "codex", token: null })
    expect(h.stoppedCodexChatIds).toEqual(["chat-1"])
  })

  test("a failed summarize turn compacts nothing", async () => {
    const h = summarizeHarness({
      events: [
        { type: "transcript", entry: makeAssistantEntry("a1", "partial") },
        { type: "transcript", entry: makeResultEntry(true) },
      ],
    })

    await runTurn(h.deps, h.active)

    expect(h.appended.map((e) => e.kind)).not.toContain("compact_boundary")
    expect(h.appended.map((e) => e.kind)).not.toContain("compact_summary")
    expect(h.tokenWrites).toEqual([])
    expect(h.stoppedCodexChatIds).toEqual([])
  })

  test("a turn that produced no summary compacts nothing", async () => {
    const h = summarizeHarness({
      events: [{ type: "transcript", entry: makeResultEntry(false) }],
    })

    await runTurn(h.deps, h.active)

    expect(h.appended.map((e) => e.kind)).not.toContain("compact_boundary")
    expect(h.tokenWrites).toEqual([])
    expect(h.stoppedCodexChatIds).toEqual([])
  })

  test("a normal turn still appends assistant_text unchanged", async () => {
    const h = summarizeHarness({
      compactionTurn: undefined,
      events: [
        { type: "transcript", entry: makeAssistantEntry("a1", "hello") },
        { type: "transcript", entry: makeResultEntry(false) },
      ],
    })

    await runTurn(h.deps, h.active)

    expect(h.appended.filter((e) => e.kind === "assistant_text")).toHaveLength(1)
    expect(h.appended.map((e) => e.kind)).not.toContain("compact_summary")
  })
})
