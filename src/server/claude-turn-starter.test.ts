/**
 * Tests for the extracted turn spawning pipeline (claude-turn-starter.ts).
 * Covers the key branches of startTurnForChat without touching agent.ts internals.
 */
import { describe, test, expect, mock } from "bun:test"
import { startTurnForChat, type StartTurnDeps, type StartTurnForChatArgs } from "./claude-turn-starter"
import { OAuthPoolUnavailableError } from "./oauth-errors"
import type { ActiveTurn, ClaudeSessionState, StartingTurn } from "./claude-session-state"
import { PendingToolSlots } from "./pending-tool-slot"
import type { HarnessTurn } from "./harness-types"
import type { TranscriptEntry } from "../shared/types"

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
  const startingTurns = new Map<string, StartingTurn>()
  const claudeSessions = new Map<string, ClaudeSessionState>()
  const drainingStreams = new Map<string, { turn: HarnessTurn }>()
  const mentionedSubagentIdsByChat = new Map<string, string[]>()

  const chat = makeFakeChatRecord()
  const project = makeFakeProjectRecord()

  const fakeTurn = makeFakeTurn()

  const deps: StartTurnDeps = {
    activeTurns,
    startingTurns,
    claudeSessions,
    drainingStreams,
    mentionedSubagentIdsByChat,

    store: {
      requireChat: mock(() => chat),
      getMessages: mock(() => []),
      getRecentRawEntries: mock(() => [] as readonly TranscriptEntry[]),
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
    closeClaudeSession: mock(() => {}),
    getSubagents: mock(() => []),
    getAppSettingsSnapshot: mock(() => ({ globalPromptAppend: undefined })),
    listSkills: mock(() => []),
    generateTitleInBackground: mock(async () => {}),
    pendingTools: new PendingToolSlots(),
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

  // Switching a stack chat to Codex used to drop the stack silently — same
  // full filesystem reach, but no idea the peer roots existed.
  describe("9b. Codex developer_instructions carry the stack", () => {
    function depsForBindings(stackBindings?: unknown) {
      const deps = makeDeps()
      const chat = makeFakeChatRecord(stackBindings ? { stackBindings } : {})
      deps.store.requireChat = mock(() => chat) as never
      return deps
    }

    function instructionsOfSession(deps: StartTurnDeps): string | undefined {
      const call = (deps.codexManager.startSession as ReturnType<typeof mock>).mock.calls[0]
      return (call?.[0] as { developerInstructions?: string }).developerInstructions
    }

    test("names each bound project for a stack chat", async () => {
      const deps = depsForBindings([
        { projectId: "proj-1", worktreePath: "/work/be", role: "primary" },
        { projectId: "proj-1b", worktreePath: "/work/fe", role: "additional" },
      ])
      await startTurnForChat(deps, makeArgs({ provider: "codex" }))
      const instructions = instructionsOfSession(deps) ?? ""
      expect(instructions).toContain("## Stack projects")
      expect(instructions).toContain("/work/be")
      expect(instructions).toContain("/work/fe")
    })

    test("a solo chat gets the workspace block and no stack block", async () => {
      const deps = depsForBindings()
      deps.getAppSettingsSnapshot = mock(() => ({ globalPromptAppend: "Always TDD." })) as never
      await startTurnForChat(deps, makeArgs({ provider: "codex" }))
      expect(instructionsOfSession(deps)).toBe("## Workspace instructions\n\nAlways TDD.")
    })
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
        backgroundTasks: new Map(),
        backgroundTaskDeadlineAt: 0,
    backgroundTaskWakeCount: 0,
    backgroundTasksLevelSourced: false,
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

// ---------------------------------------------------------------------------
// Provider-boot window
//
// Regression: the ActiveTurn is only registered AFTER the provider session
// spawns, so for that whole window (seconds on a cold chat) the chat had no
// server-side record — Stop no-oped and a second chat.send started a
// concurrent turn. A StartingTurn marker now covers the gap.
// ---------------------------------------------------------------------------

/** A promise plus its resolver, for pausing a mocked provider boot. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe("startTurnForChat — starting-turn marker", () => {
  test("registers a starting marker before the provider boot and clears it on success", async () => {
    const gate = deferred<HarnessTurn>()
    const deps = makeDeps({ codexManager: {
      startSession: mock(async () => null),
      startTurn: mock(() => gate.promise),
    } as unknown as StartTurnDeps["codexManager"] })

    const pending = startTurnForChat(deps, makeArgs({ provider: "codex" }))
    // Let the pre-boot awaits settle, then assert the marker exists while the
    // provider is still booting and no ActiveTurn has been registered yet.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(deps.startingTurns.has("chat-1")).toBe(true)
    expect(deps.activeTurns.has("chat-1")).toBe(false)

    gate.resolve(makeFakeTurn())
    await pending

    expect(deps.startingTurns.has("chat-1")).toBe(false)
    expect(deps.activeTurns.has("chat-1")).toBe(true)
  })

  test("throws when a starting marker already exists (concurrent boot)", async () => {
    const deps = makeDeps()
    deps.startingTurns.set("chat-1", {
      chatId: "chat-1",
      provider: "codex",
      startedAt: Date.now(),
      cancelRequested: false,
    })

    await expect(startTurnForChat(deps, makeArgs())).rejects.toThrow("Chat is already running")
  })

  test("clears the marker when the boot throws", async () => {
    const deps = makeDeps({
      startClaudeTurn: mock(async () => { throw new Error("spawn failed") }),
    })

    await expect(
      startTurnForChat(deps, makeArgs({ provider: "claude", model: "claude-opus-4-5" })),
    ).rejects.toThrow("spawn failed")

    expect(deps.startingTurns.has("chat-1")).toBe(false)
  })

  test("cancel during the boot tears the fresh turn down instead of registering it", async () => {
    const gate = deferred<HarnessTurn>()
    const interrupt = mock(async () => {})
    const close = mock(() => {})
    const deps = makeDeps({ codexManager: {
      startSession: mock(async () => null),
      startTurn: mock(() => gate.promise),
    } as unknown as StartTurnDeps["codexManager"] })

    const pending = startTurnForChat(deps, makeArgs({ provider: "codex" }))
    await new Promise((r) => setTimeout(r, 0))

    // Simulate cancelChat landing mid-boot.
    const starting = deps.startingTurns.get("chat-1")!
    starting.cancelRequested = true
    deps.startingTurns.delete("chat-1")

    gate.resolve({ ...makeFakeTurn(), interrupt, close })
    await pending

    expect(deps.activeTurns.has("chat-1")).toBe(false)
    expect(deps.runTurn as ReturnType<typeof mock>).not.toHaveBeenCalled()
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  test("cancel during a claude PTY boot also drops the dead session", async () => {
    const gate = deferred<HarnessTurn>()
    const closeClaudeSession = mock(() => {})
    const deps = makeDeps({
      resolveClaudeDriverPreference: mock(() => "pty" as const),
      closeClaudeSession,
    })
    deps.startClaudeTurn = mock(() => {
      deps.claudeSessions.set("chat-1", { chatId: "chat-1" } as unknown as ClaudeSessionState)
      return gate.promise
    })

    const pending = startTurnForChat(deps, makeArgs({ provider: "claude", model: "claude-opus-4-5" }))
    await new Promise((r) => setTimeout(r, 0))

    const starting = deps.startingTurns.get("chat-1")!
    starting.cancelRequested = true
    deps.startingTurns.delete("chat-1")

    gate.resolve(makeFakeTurn())
    await pending

    expect(deps.activeTurns.has("chat-1")).toBe(false)
    expect(closeClaudeSession).toHaveBeenCalledTimes(1)
  })

  test("a cancelled boot does not clear a newer turn's marker", async () => {
    const gate = deferred<HarnessTurn>()
    const deps = makeDeps({ codexManager: {
      startSession: mock(async () => null),
      startTurn: mock(() => gate.promise),
    } as unknown as StartTurnDeps["codexManager"] })

    const pending = startTurnForChat(deps, makeArgs({ provider: "codex" }))
    await new Promise((r) => setTimeout(r, 0))

    // Cancel removes the first marker, then a fresh turn registers its own.
    const first = deps.startingTurns.get("chat-1")!
    first.cancelRequested = true
    deps.startingTurns.delete("chat-1")
    const second: StartingTurn = {
      chatId: "chat-1",
      provider: "codex",
      startedAt: Date.now(),
      cancelRequested: false,
    }
    deps.startingTurns.set("chat-1", second)

    gate.resolve(makeFakeTurn())
    await pending

    // The first boot's identity-guarded cleanup must leave the second alone.
    expect(deps.startingTurns.get("chat-1")).toBe(second)
  })

  test("onToolRequest parks in the slot — never a ghost turn — when the prior turn already finalized", async () => {
    let captured: ((request: { tool: unknown }) => Promise<unknown>) | null = null

    const deps = makeDeps({
      startClaudeTurn: mock(async (args: { onToolRequest: (r: { tool: unknown }) => Promise<unknown> }) => {
        captured = args.onToolRequest
        return makeFakeTurn()
      }) as unknown as StartTurnDeps["startClaudeTurn"],
    })
    // The claude path delivers its prompt through the SDK session queue.
    deps.claudeSessions.set("chat-1", {
      id: "sess-1",
      chatId: "chat-1",
      nextPromptSeq: 0,
      pendingPromptSeqs: [],
      cancelledResultPending: 0,
      lastUsedAt: 0,
      session: { sendPrompt: async () => {} },
    } as unknown as ClaudeSessionState)

    await startTurnForChat(deps, makeArgs({ provider: "claude", model: "claude-opus-4-5" }))
    expect(captured).not.toBeNull()

    // Simulate the SDK self-resuming after a background-task notification:
    // the turn that owned this session is already gone from activeTurns.
    deps.activeTurns.delete("chat-1")

    const tool = {
      kind: "tool",
      toolKind: "ask_user_question",
      toolName: "ask_user_question",
      toolId: "toolu_x",
      input: { questions: [] },
    }
    // Never resolves — this IS the parked canUseTool continuation. Do not await.
    void captured!({ tool })

    expect(deps.pendingTools.get("chat-1")?.toolUseId).toBe("toolu_x")
    expect(deps.activeTurns.has("chat-1")).toBe(false)
  })

  test("onToolRequest during a live turn parks in the slot and flips the turn to waiting_for_user", async () => {
    let captured: ((request: { tool: unknown }) => Promise<unknown>) | null = null

    const deps = makeDeps({
      startClaudeTurn: mock(async (args: { onToolRequest: (r: { tool: unknown }) => Promise<unknown> }) => {
        captured = args.onToolRequest
        return makeFakeTurn()
      }) as unknown as StartTurnDeps["startClaudeTurn"],
    })
    deps.claudeSessions.set("chat-1", {
      id: "sess-1",
      chatId: "chat-1",
      nextPromptSeq: 0,
      pendingPromptSeqs: [],
      cancelledResultPending: 0,
      lastUsedAt: 0,
      session: { sendPrompt: async () => {} },
    } as unknown as ClaudeSessionState)

    await startTurnForChat(deps, makeArgs({ provider: "claude", model: "claude-opus-4-5" }))
    expect(captured).not.toBeNull()
    const active = deps.activeTurns.get("chat-1")
    expect(active).toBeDefined()

    const tool = {
      kind: "tool",
      toolKind: "ask_user_question",
      toolName: "ask_user_question",
      toolId: "toolu_live",
      input: { questions: [] },
    }
    void captured!({ tool })

    expect(deps.pendingTools.get("chat-1")?.toolUseId).toBe("toolu_live")
    expect(active?.status).toBe("waiting_for_user")
    expect(active?.waitStartedAt).not.toBeNull()
  })
})

describe("history primer loading", () => {
  const primerEntries: TranscriptEntry[] = [
    { _id: "u-1", kind: "user_prompt", createdAt: 100, content: "hello" } as TranscriptEntry,
    { _id: "a-1", kind: "assistant_text", createdAt: 200, text: "world" } as TranscriptEntry,
  ]

  test("uses getRecentRawEntries instead of getMessages when injecting primer", async () => {
    const getMessagesMock = mock(() => primerEntries)
    const getRecentRawEntriesMock = mock((_chatId: string, _limit: number) => primerEntries as readonly TranscriptEntry[])
    const fakeTurn = makeFakeTurn()

    const establishedChat = makeFakeChatRecord({
      title: "Established Chat",
      hasMessages: true,
      sessionTokensByProvider: {},
    })

    const deps = makeDeps({
      store: {
        requireChat: mock(() => establishedChat),
        getMessages: getMessagesMock,
        getRecentRawEntries: getRecentRawEntriesMock,
        getProject: mock(() => makeFakeProjectRecord()),
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
    })

    await startTurnForChat(deps, makeArgs({ provider: "codex" }))

    expect(getRecentRawEntriesMock.mock.calls.length).toBeGreaterThan(0)
    expect(getMessagesMock.mock.calls.length).toBe(0)
  })

  test("passes a positive tail limit to getRecentRawEntries for primer", async () => {
    const capturedLimits: number[] = []
    const getRecentRawEntriesMock = mock((_chatId: string, limit: number) => {
      capturedLimits.push(limit)
      return primerEntries as readonly TranscriptEntry[]
    })
    const fakeTurn = makeFakeTurn()

    const establishedChat = makeFakeChatRecord({
      title: "Established Chat",
      hasMessages: true,
      sessionTokensByProvider: {},
    })

    const deps = makeDeps({
      store: {
        requireChat: mock(() => establishedChat),
        getMessages: mock(() => []),
        getRecentRawEntries: getRecentRawEntriesMock,
        getProject: mock(() => makeFakeProjectRecord()),
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
    })

    await startTurnForChat(deps, makeArgs({ provider: "codex" }))

    expect(capturedLimits.length).toBeGreaterThan(0)
    expect(capturedLimits[0]).toBeGreaterThanOrEqual(500)
  })
})
