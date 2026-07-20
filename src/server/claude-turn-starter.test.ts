/**
 * Tests for the extracted turn spawning pipeline (claude-turn-starter.ts).
 * Covers the key branches of startTurnForChat without touching agent.ts internals.
 */
import { describe, test, expect, mock } from "bun:test"
import { startTurnForChat, type StartTurnDeps, type StartTurnForChatArgs } from "./claude-turn-starter"
import { OAuthPoolUnavailableError } from "./oauth-errors"
import type { ActiveTurn, ClaudeSessionState } from "./claude-session-state"
import type { HarnessTurn } from "./harness-types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeTurn(): HarnessTurn {
  return {
    provider: "codex",
    stream: { async *[Symbol.asyncIterator]() {} },
    interrupt: async () => {},
    close: () => {},
  }
}

function makeFakeChatRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "chat-1",
    projectId: "proj-1",
    provider: "codex" as const,
    title: "New Chat",
    sessionTokensByProvider: {},
    pendingForkSessionToken: null,
    ...overrides,
  }
}

function makeFakeProjectRecord() {
  return {
    id: "proj-1",
    localPath: "/tmp/project",
    title: "Test Project",
  }
}

function makeDeps(overrides: Partial<StartTurnDeps> = {}): StartTurnDeps {
  const activeTurns = new Map<string, ActiveTurn>()
  const claudeSessions = new Map<string, ClaudeSessionState>()
  const drainingStreams = new Map<string, { turn: HarnessTurn }>()
  const mentionedSubagentIdsByChat = new Map<string, string[]>()

  const chat = makeFakeChatRecord()
  const project = makeFakeProjectRecord()

  const fakeTurn = makeFakeTurn()

  const deps: StartTurnDeps = {
    activeTurns,
    claudeSessions,
    drainingStreams,
    mentionedSubagentIdsByChat,

    store: {
      requireChat: mock(() => chat),
      getMessages: mock(() => []),
      getProject: mock(() => project),
      appendMessage: mock(async () => {}),
      setChatProvider: mock(async () => {}),
      setPlanMode: mock(async () => {}),
      renameChat: mock(async () => {}),
      recordTurnStarted: mock(async () => {}),
      recordTurnFailed: mock(async () => {}),
      setPendingForkSessionToken: mock(async () => {}),
    } as unknown as StartTurnDeps["store"],

    codexManager: {
      startSession: mock(async () => null),
      startTurn: mock(async () => fakeTurn),
    } as unknown as StartTurnDeps["codexManager"],

    subagentOrchestrator: {
      clearChatCancellation: mock(() => {}),
    },

    clearDrainingStream: mock(() => {}),
    emitStateChange: mock(() => {}),
    resolveClaudeDriverPreference: mock(() => "sdk" as const),
    getSubagents: mock(() => []),
    getAppSettingsSnapshot: mock(() => ({ globalPromptAppend: undefined })),
    generateTitleInBackground: mock(async () => {}),
    recreateActiveTurnFromSession: mock(() => undefined),
    startClaudeTurn: mock(async () => fakeTurn),
    findLastUserMessageId: mock(() => null),
    runTurn: mock(() => {}),

    ...overrides,
  }

  return deps
}

function makeArgs(overrides: Partial<StartTurnForChatArgs> = {}): StartTurnForChatArgs {
  return {
    chatId: "chat-1",
    provider: "codex",
    content: "hello world",
    attachments: [],
    model: "gpt-4o",
    planMode: false,
    appendUserPrompt: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startTurnForChat", () => {
  test("1. closes a draining stream before starting a new turn", async () => {
    const deps = makeDeps()
    const closeFn = mock(() => {})
    deps.drainingStreams.set("chat-1", { turn: { ...makeFakeTurn(), close: closeFn } })

    await startTurnForChat(deps, makeArgs())

    expect(closeFn).toHaveBeenCalledTimes(1)
    expect(deps.clearDrainingStream as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1")
  })

  test("2. throws when chat is already running (activeTurns has the chatId)", async () => {
    const deps = makeDeps()
    // Pre-populate activeTurns to simulate an in-flight turn
    deps.activeTurns.set("chat-1", {} as ActiveTurn)

    await expect(startTurnForChat(deps, makeArgs())).rejects.toThrow("Chat is already running")
  })

  test("3. clears cancellation on subagentOrchestrator at the start", async () => {
    const deps = makeDeps()
    await startTurnForChat(deps, makeArgs())
    expect((deps.subagentOrchestrator.clearChatCancellation as ReturnType<typeof mock>)).toHaveBeenCalledWith("chat-1")
  })

  test("4. appends user_prompt entry when appendUserPrompt is true", async () => {
    const deps = makeDeps()
    await startTurnForChat(deps, makeArgs({ appendUserPrompt: true }))
    expect(deps.store.appendMessage as ReturnType<typeof mock>).toHaveBeenCalled()
  })

  test("5. does NOT append user_prompt entry when appendUserPrompt is false", async () => {
    const deps = makeDeps()
    await startTurnForChat(deps, makeArgs({ appendUserPrompt: false }))
    // appendMessage may be called for other things (account_info etc), but
    // we can check that user_prompt was not the kind persisted.
    const appendCalls = (deps.store.appendMessage as ReturnType<typeof mock>).mock.calls
    const userPromptCalls = appendCalls.filter(
      (call: unknown[]) => (call[1] as { kind?: string })?.kind === "user_prompt"
    )
    expect(userPromptCalls).toHaveLength(0)
  })

  test("6. calls recordTurnStarted with correct fields", async () => {
    const deps = makeDeps()
    await startTurnForChat(deps, makeArgs({ provider: "codex", model: "gpt-4o", planMode: true }))
    expect(deps.store.recordTurnStarted as ReturnType<typeof mock>).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({ provider: "codex", model: "gpt-4o", planMode: true })
    )
  })

  test("7. swallows OAuthPoolUnavailableError and persists a result error entry", async () => {
    const oauthError = new OAuthPoolUnavailableError("pool is full")
    const deps = makeDeps({
      startClaudeTurn: mock(async () => { throw oauthError }),
      // Make it a claude provider so startClaudeTurn gets called
    })
    // Use claude provider so isClaudeSdkProvider returns true → startClaudeTurn called
    const args = makeArgs({ provider: "claude", model: "claude-opus-4-5" })

    // Should NOT throw (swallowed)
    await expect(startTurnForChat(deps, args)).resolves.toBeUndefined()

    // Should persist the error as a result entry
    const appendCalls = (deps.store.appendMessage as ReturnType<typeof mock>).mock.calls
    const resultEntries = appendCalls.filter(
      (call: unknown[]) => {
        const entry = call[1] as { kind?: string; isError?: boolean }
        return entry?.kind === "result" && entry?.isError === true
      }
    )
    expect(resultEntries.length).toBeGreaterThan(0)
  })

  test("8. rethrows non-OAuth errors after cleanup (recordTurnFailed, emitStateChange)", async () => {
    const boom = new Error("unexpected failure")
    const deps = makeDeps({
      startClaudeTurn: mock(async () => { throw boom }),
    })
    const args = makeArgs({ provider: "claude", model: "claude-opus-4-5" })

    await expect(startTurnForChat(deps, args)).rejects.toThrow("unexpected failure")

    // Cleanup should still run
    expect(deps.store.recordTurnFailed as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1", "unexpected failure")
    expect(deps.emitStateChange as ReturnType<typeof mock>).toHaveBeenCalledWith("chat-1", { immediate: true })
  })

  test("9. routes to codexManager.startTurn for non-claude providers", async () => {
    const deps = makeDeps()
    await startTurnForChat(deps, makeArgs({ provider: "codex", model: "gpt-4o" }))
    expect(deps.codexManager.startTurn as ReturnType<typeof mock>).toHaveBeenCalledTimes(1)
    expect(deps.startClaudeTurn as ReturnType<typeof mock>).not.toHaveBeenCalled()
  })

  test("10. routes to startClaudeTurn for claude provider", async () => {
    const deps = makeDeps()
    const fakeTurn = makeFakeTurn()
    // The real startClaudeTurn populates claudeSessions as a side effect;
    // our mock must do the same so the SDK-session prompt-send path can proceed.
    deps.startClaudeTurn = mock(async () => {
      deps.claudeSessions.set("chat-1", {
        id: "sess-1",
        chatId: "chat-1",
        session: { sendPrompt: mock(async () => {}), getAccountInfo: undefined },
        localPath: "/tmp/project",
        additionalDirectories: [],
        model: "claude-opus-4-5",
        effort: undefined,
        planMode: false,
        sessionToken: null,
        accountInfoLoaded: false,
        nextPromptSeq: 0,
        pendingPromptSeqs: [],
        activeTokenId: null,
        oauthKeyMasked: null,
        oauthLabel: null,
        openrouterKeyMasked: null,
        openrouterModel: null,
        lastUsedAt: Date.now(),
        backgroundTaskIds: new Set<string>(),
        backgroundTaskDeadlineAt: 0,
        loopArmedAtSpawn: false,
        cancelledResultPending: 0,
        suppressSessionTokenPersist: false,
      } as unknown as ClaudeSessionState)
      return fakeTurn
    })

    await startTurnForChat(deps, makeArgs({ provider: "claude", model: "claude-opus-4-5" }))
    expect(deps.startClaudeTurn as ReturnType<typeof mock>).toHaveBeenCalledTimes(1)
    expect(deps.codexManager.startTurn as ReturnType<typeof mock>).not.toHaveBeenCalled()
  })

  test("11. registers ActiveTurn in activeTurns map after turn starts", async () => {
    const deps = makeDeps()
    await startTurnForChat(deps, makeArgs({ provider: "codex" }))
    expect(deps.activeTurns.has("chat-1")).toBe(true)
    const active = deps.activeTurns.get("chat-1")
    expect(active?.provider).toBe("codex")
  })

  test("12. calls runTurn for Codex (non-SDK-session) provider", async () => {
    const deps = makeDeps()
    await startTurnForChat(deps, makeArgs({ provider: "codex" }))
    expect(deps.runTurn as ReturnType<typeof mock>).toHaveBeenCalledTimes(1)
  })
})
