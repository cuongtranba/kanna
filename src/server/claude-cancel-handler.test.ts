/**
 * Tests for the extracted cancelChat standalone function.
 *
 * Each test builds a minimal `CancelHandlerDeps` fake and asserts the
 * correct behaviour without any real IO or OS calls.
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { cancelChat, type CancelHandlerDeps } from "./claude-cancel-handler"
import { ClaudeSessionState } from "./claude-session-state"
import type { ActiveTurn, StartingTurn } from "./claude-session-state"
import { PendingToolSlots, type ParkedTool } from "./pending-tool-slot"
import type { HarnessTurn, ClaudeSessionHandle } from "./harness-types"
import type { TranscriptEntry } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal HarnessTurn (used for ActiveTurn.turn). */
function makeFakeTurn(overrides: Partial<HarnessTurn> = {}): HarnessTurn {
  return {
    provider: "claude",
    stream: (async function* () {})() as AsyncIterable<never>,
    interrupt: async () => {},
    close: () => {},
    ...overrides,
  }
}

/** Minimal ClaudeSessionHandle (used for ClaudeSessionState.session). */
function makeFakeHandle(): ClaudeSessionHandle {
  return {
    provider: "claude",
    stream: (async function* () {})() as AsyncIterable<never>,
    interrupt: async () => {},
    close: () => {},
    closed: Promise.resolve(),
    sendPrompt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
    getSupportedCommands: async () => [],
  }
}

function makeActiveTurn(overrides: Partial<ActiveTurn> = {}): ActiveTurn {
  return {
    chatId: "chat-1",
    provider: "claude",
    turn: makeFakeTurn(),
    startedAt: Date.now(),
    model: "claude-opus-4",
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

function makeSession(overrides: Partial<ConstructorParameters<typeof ClaudeSessionState>[0]> = {}): ClaudeSessionState {
  return new ClaudeSessionState({
    id: "sess-1",
    chatId: "chat-1",
    session: makeFakeHandle(),
    localPath: "/home/user/project",
    additionalDirectories: [],
    model: "claude-opus-4",
    planMode: false,
    sessionToken: null,
    accountInfoLoaded: false,
    nextPromptSeq: 1,
    pendingPromptSeqs: [],
    activeTokenId: null,
    oauthKeyMasked: null,
    oauthLabel: null,
    openrouterKeyMasked: null,
    openrouterModel: null,
    lastUsedAt: Date.now(),
    backgroundTasks: new Map(),
    selfWakeActive: false,
    recentToolDescriptions: new Map(),
    backgroundLaunchToolIds: new Set<string>(),
    backgroundTaskDeadlineAt: 0,
    backgroundTaskWakeCount: 0,
    backgroundTasksLevelSourced: false,
    loopArmedAtSpawn: false,
    workflowsDirRegistered: false,
    cancelledResultPending: 0,
    suppressSessionTokenPersist: false,
    backgroundTaskWakeSuppressed: false,
    ...overrides,
  })
}

function makeStartingTurn(overrides: Partial<StartingTurn> = {}): StartingTurn {
  return {
    chatId: "chat-1",
    provider: "claude",
    startedAt: Date.now(),
    cancelRequested: false,
    ...overrides,
  }
}

type DepOverrides = {
  drainingStreams?: Map<string, { turn: HarnessTurn }>
  activeTurns?: Map<string, ActiveTurn>
  pendingTools?: PendingToolSlots
  startingTurns?: Map<string, StartingTurn>
  claudeSessions?: Map<string, ClaudeSessionState>
  appendedMessages?: TranscriptEntry[]
  turnCancelledFor?: string[]
  stateChanges?: string[]
  rejectCalled?: string[]
  orchestratorCancelled?: string[]
  closedSessions?: string[]
  driver?: "sdk" | "pty"
}

function makeDeps(overrides: DepOverrides = {}): CancelHandlerDeps {
  const drainingStreams: Map<string, { turn: HarnessTurn }> = overrides.drainingStreams ?? new Map()
  const activeTurns: Map<string, ActiveTurn> = overrides.activeTurns ?? new Map()
  const pendingTools: PendingToolSlots = overrides.pendingTools ?? new PendingToolSlots()
  const startingTurns: Map<string, StartingTurn> = overrides.startingTurns ?? new Map()
  const claudeSessions: Map<string, ClaudeSessionState> = overrides.claudeSessions ?? new Map()
  const appendedMessages = overrides.appendedMessages ?? []
  const turnCancelledFor = overrides.turnCancelledFor ?? []
  const stateChanges = overrides.stateChanges ?? []
  const rejectCalled = overrides.rejectCalled ?? []
  const orchestratorCancelled = overrides.orchestratorCancelled ?? []
  const closedSessions = overrides.closedSessions ?? []
  const driver = overrides.driver ?? "sdk"

  return {
    drainingStreams,
    rejectPendingResolversForChat: (chatId) => { rejectCalled.push(chatId) },
    cancelChatInOrchestrator: (chatId) => { orchestratorCancelled.push(chatId) },
    activeTurns,
    pendingTools,
    startingTurns,
    store: {
      appendMessage: async (_chatId, entry) => { appendedMessages.push(entry) },
      recordTurnCancelled: async (chatId) => { turnCancelledFor.push(chatId) },
    },
    claudeSessions,
    emitStateChange: (chatId) => { stateChanges.push(chatId) },
    resolveClaudeDriverPreference: () => driver,
    closeClaudeSession: (chatId) => { closedSessions.push(chatId) },
  }
}

// ---------------------------------------------------------------------------
// No active turn
// ---------------------------------------------------------------------------

describe("no active turn", () => {
  test("resolvers are rejected and orchestrator signalled even with no active turn", async () => {
    const rejectCalled: string[] = []
    const orchestratorCancelled: string[] = []
    const deps = makeDeps({ rejectCalled, orchestratorCancelled })
    await cancelChat(deps, "chat-1")
    expect(rejectCalled).toContain("chat-1")
    expect(orchestratorCancelled).toContain("chat-1")
  })

  test("no messages appended when no active turn", async () => {
    const appendedMessages: TranscriptEntry[] = []
    const deps = makeDeps({ appendedMessages })
    await cancelChat(deps, "chat-1")
    expect(appendedMessages.length).toBe(0)
  })

  test("closes and removes a draining stream if present", async () => {
    let closed = false
    const fakeTurn = makeFakeTurn({ close: () => { closed = true } })
    const drainingStreams = new Map([["chat-1", { turn: fakeTurn }]])
    const deps = makeDeps({ drainingStreams })
    await cancelChat(deps, "chat-1")
    expect(closed).toBe(true)
    expect(drainingStreams.has("chat-1")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// No active turn — cancel during the provider-boot window
//
// Regression: startTurnForChat registers the ActiveTurn only AFTER the provider
// session spawns, so Stop pressed during that window used to hit `if (!active)
// return` and no-op silently — the user had to press Stop a second time.
// ---------------------------------------------------------------------------

describe("starting turn cancel (provider-boot window)", () => {
  test("marks the starting turn cancelled so the booting turn tears itself down", async () => {
    const starting = makeStartingTurn()
    const startingTurns = new Map([["chat-1", starting]])
    const deps = makeDeps({ startingTurns })

    await cancelChat(deps, "chat-1")

    expect(starting.cancelRequested).toBe(true)
  })

  test("removes the marker so the chat reports idle immediately", async () => {
    const startingTurns = new Map([["chat-1", makeStartingTurn()]])
    const stateChanges: string[] = []
    const deps = makeDeps({ startingTurns, stateChanges })

    await cancelChat(deps, "chat-1")

    expect(startingTurns.has("chat-1")).toBe(false)
    expect(stateChanges).toContain("chat-1")
  })

  test("appends exactly one interrupted entry and records the cancelled turn", async () => {
    const startingTurns = new Map([["chat-1", makeStartingTurn()]])
    const appendedMessages: TranscriptEntry[] = []
    const turnCancelledFor: string[] = []
    const deps = makeDeps({ startingTurns, appendedMessages, turnCancelledFor })

    await cancelChat(deps, "chat-1")

    const interrupted = appendedMessages.filter((entry) => entry.kind === "interrupted")
    expect(interrupted).toHaveLength(1)
    expect(turnCancelledFor).toEqual(["chat-1"])
  })

  test("honours hideInterrupted on the starting-turn path", async () => {
    const startingTurns = new Map([["chat-1", makeStartingTurn()]])
    const appendedMessages: TranscriptEntry[] = []
    const deps = makeDeps({ startingTurns, appendedMessages })

    await cancelChat(deps, "chat-1", { hideInterrupted: true })

    const interrupted = appendedMessages.find((entry) => entry.kind === "interrupted")
    expect(interrupted).toMatchObject({ hidden: true })
  })

  test("leaves other chats' starting turns untouched", async () => {
    const other = makeStartingTurn({ chatId: "chat-2" })
    const startingTurns = new Map([
      ["chat-1", makeStartingTurn()],
      ["chat-2", other],
    ])
    const deps = makeDeps({ startingTurns })

    await cancelChat(deps, "chat-1")

    expect(other.cancelRequested).toBe(false)
    expect(startingTurns.has("chat-2")).toBe(true)
  })

  test("an ActiveTurn takes precedence over a stale starting marker", async () => {
    const starting = makeStartingTurn()
    const active = makeActiveTurn()
    const turnCancelledFor: string[] = []
    const deps = makeDeps({
      activeTurns: new Map([["chat-1", active]]),
      startingTurns: new Map([["chat-1", starting]]),
      turnCancelledFor,
    })

    await cancelChat(deps, "chat-1")

    expect(active.cancelRequested).toBe(true)
    expect(turnCancelledFor).toEqual(["chat-1"])
  })
})

// ---------------------------------------------------------------------------
// No active turn — self-wake turn interrupt
// ---------------------------------------------------------------------------

describe("self-wake turn cancel", () => {
  test("interrupts the session stream, appends interrupted, clears the flag", async () => {
    let interrupted = false
    const session = makeSession({ selfWakeActive: true })
    session.session = {
      ...session.session,
      interrupt: async () => { interrupted = true },
    }
    const appendedMessages: TranscriptEntry[] = []
    const stateChanges: string[] = []
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      appendedMessages,
      stateChanges,
    })

    await cancelChat(deps, "chat-1")

    expect(interrupted).toBe(true)
    expect(session.selfWakeActive).toBe(false)
    expect(session.cancelledResultPending).toBe(1)
    expect(appendedMessages.map((entry) => entry.kind)).toContain("interrupted")
    expect(stateChanges).toContain("chat-1")
  })

  test("PTY driver drops the dead session after a self-wake interrupt", async () => {
    const session = makeSession({ selfWakeActive: true })
    session.session = {
      ...session.session,
      interrupt: async () => {},
    }
    const closedSessions: string[] = []
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      closedSessions,
      driver: "pty",
    })

    await cancelChat(deps, "chat-1")

    expect(closedSessions).toContain("chat-1")
  })

  test("no self-wake, no session interrupt — stays a no-op", async () => {
    let interrupted = false
    const session = makeSession({ selfWakeActive: false })
    session.session = {
      ...session.session,
      interrupt: async () => { interrupted = true },
    }
    const appendedMessages: TranscriptEntry[] = []
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      appendedMessages,
    })

    await cancelChat(deps, "chat-1")

    expect(interrupted).toBe(false)
    expect(appendedMessages.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Active turn — concurrent cancel guard
// ---------------------------------------------------------------------------

describe("concurrent cancel guard", () => {
  test("second call is no-op when cancelRequested is already true", async () => {
    const appendedMessages: TranscriptEntry[] = []
    const active = makeActiveTurn({ cancelRequested: true })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, appendedMessages })
    await cancelChat(deps, "chat-1")
    // No messages should be appended because the guard returns early
    expect(appendedMessages.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Active turn — transcript entries
// ---------------------------------------------------------------------------

describe("transcript entries", () => {
  let appendedMessages: TranscriptEntry[]
  let turnCancelledFor: string[]
  let activeTurns: Map<string, ActiveTurn>

  beforeEach(() => {
    appendedMessages = []
    turnCancelledFor = []
    const active = makeActiveTurn()
    activeTurns = new Map([["chat-1", active]])
  })

  test("appends interrupted entry with hidden=undefined by default", async () => {
    const deps = makeDeps({ activeTurns, appendedMessages, turnCancelledFor })
    await cancelChat(deps, "chat-1")
    const interrupted = appendedMessages.find((m) => m.kind === "interrupted")
    expect(interrupted).toBeDefined()
    expect((interrupted as { hidden?: boolean })?.hidden).toBeUndefined()
  })

  test("appends interrupted entry with hidden=true when hideInterrupted is set", async () => {
    const deps = makeDeps({ activeTurns, appendedMessages, turnCancelledFor })
    await cancelChat(deps, "chat-1", { hideInterrupted: true })
    const interrupted = appendedMessages.find((m) => m.kind === "interrupted")
    expect((interrupted as { hidden?: boolean })?.hidden).toBe(true)
  })

  test("records turn_cancelled via store.recordTurnCancelled", async () => {
    const deps = makeDeps({ activeTurns, appendedMessages, turnCancelledFor })
    await cancelChat(deps, "chat-1")
    expect(turnCancelledFor).toContain("chat-1")
  })

  test("sets cancelRecorded and hasFinalResult on active turn", async () => {
    const active = makeActiveTurn()
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns: turns, appendedMessages, turnCancelledFor })
    await cancelChat(deps, "chat-1")
    expect(active.cancelRecorded).toBe(true)
    expect(active.hasFinalResult).toBe(true)
  })

  test("removes chat from activeTurns", async () => {
    const active = makeActiveTurn()
    const turns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns: turns, appendedMessages, turnCancelledFor })
    await cancelChat(deps, "chat-1")
    expect(turns.has("chat-1")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Active turn — pending tool handling
// ---------------------------------------------------------------------------

describe("pending tool", () => {
  function parkPendingTool(
    slots: PendingToolSlots,
    toolKind: "ask_user_question" | "exit_plan_mode",
    toolId: string,
    resolve: (result: unknown) => void,
    provider: ActiveTurn["provider"] = "claude",
  ): void {
    const tool = toolKind === "ask_user_question"
      ? { kind: "tool", toolKind: "ask_user_question", toolName: "AskUserQuestion", toolId, input: { questions: [] } }
      : { kind: "tool", toolKind: "exit_plan_mode", toolName: "ExitPlanMode", toolId, input: {} }
    slots.park("chat-1", {
      toolUseId: toolId,
      provider,
      tool: tool as ParkedTool["tool"],
      parkedAt: Date.now(),
      resolve,
    })
  }

  test("appends tool_result entry when a request is parked", async () => {
    const appendedMessages: TranscriptEntry[] = []
    const pendingTools = new PendingToolSlots()
    parkPendingTool(pendingTools, "ask_user_question", "tool-use-1", () => {})
    const activeTurns = new Map([["chat-1", makeActiveTurn()]])
    const deps = makeDeps({ activeTurns, pendingTools, appendedMessages })
    await cancelChat(deps, "chat-1")
    const toolResult = appendedMessages.find((m) => m.kind === "tool_result")
    expect(toolResult).toBeDefined()
    expect((toolResult as { toolId?: string })?.toolId).toBe("tool-use-1")
    expect(pendingTools.has("chat-1")).toBe(false)
  })

  // The settle is provider- and toolKind-agnostic: dropping the resolve left
  // the SDK worker blocked inside canUseTool while the ActiveTurn was
  // deleted, so respondTool threw "No pending tool request" and Stop could
  // never recover the chat. Resolving (never rejecting — a rejection throws
  // inside the SDK worker) is the only in-band way out.
  test.each([
    ["claude", "ask_user_question"],
    ["claude", "exit_plan_mode"],
    ["codex", "ask_user_question"],
    ["codex", "exit_plan_mode"],
    ["openrouter", "exit_plan_mode"],
  ] as const)(
    "resolves the parked request with the discarded payload (provider=%s, toolKind=%s)",
    async (provider, toolKind) => {
      let resolved: unknown = undefined
      const pendingTools = new PendingToolSlots()
      parkPendingTool(pendingTools, toolKind, "tool-use-3", (result) => { resolved = result }, provider)
      const active = makeActiveTurn({ provider })
      const deps = makeDeps({ activeTurns: new Map([["chat-1", active]]), pendingTools })

      await cancelChat(deps, "chat-1")

      expect(resolved).toMatchObject({ discarded: true })
    },
  )

  test("settles a request parked with NO active turn (SDK self-wake) on the FIRST Stop", async () => {
    // Regression for session 04fb43c9: a question parked during a
    // background-task self-wake has no ActiveTurn. One Stop must settle the
    // continuation, append the discarded tool_result, AND clear the
    // self-wake flag — previously the first press only handled the turn
    // branch and a second press was needed for the flag.
    let resolved: unknown = undefined
    const appendedMessages: TranscriptEntry[] = []
    const pendingTools = new PendingToolSlots()
    parkPendingTool(pendingTools, "ask_user_question", "tool-use-5", (result) => { resolved = result })
    const session = makeSession({ selfWakeActive: true })
    const deps = makeDeps({
      pendingTools,
      appendedMessages,
      claudeSessions: new Map([["chat-1", session]]),
    })

    await cancelChat(deps, "chat-1")

    expect(resolved).toMatchObject({ discarded: true })
    expect(pendingTools.has("chat-1")).toBe(false)
    expect(session.selfWakeActive).toBe(false)
    expect(appendedMessages.some((m) => m.kind === "tool_result")).toBe(true)
    expect(appendedMessages.some((m) => m.kind === "interrupted")).toBe(true)
  })

  test("appends the discarded tool_result BEFORE resolving", async () => {
    // Share one array so append/resolve interleaving is observable: the
    // transcript must already carry the discarded marker by the time the SDK
    // worker is released, otherwise the UI can render an unanswered card.
    const appendedMessages: TranscriptEntry[] = []
    let appendedWhenResolved = -1
    const pendingTools = new PendingToolSlots()
    parkPendingTool(pendingTools, "ask_user_question", "tool-use-4", () => {
      appendedWhenResolved = appendedMessages.length
    })
    const active = makeActiveTurn({ provider: "claude" })
    const deps = makeDeps({ activeTurns: new Map([["chat-1", active]]), pendingTools, appendedMessages })

    await cancelChat(deps, "chat-1")

    const appendIdx = appendedMessages.findIndex((m) => m.kind === "tool_result")
    expect(appendIdx).toBeGreaterThanOrEqual(0)
    // The tool_result was already in the transcript when the worker resumed.
    expect(appendedWhenResolved).toBeGreaterThan(appendIdx)
  })
})

// ---------------------------------------------------------------------------
// Claude session prompt-seq drain
// ---------------------------------------------------------------------------

describe("claude session prompt-seq drain", () => {
  test("removes claudePromptSeq from pendingPromptSeqs", async () => {
    const session = makeSession({ pendingPromptSeqs: [1, 2, 3] })
    const claudeSessions = new Map([["chat-1", session]])
    const active = makeActiveTurn({ provider: "claude", claudePromptSeq: 2 })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, claudeSessions })
    await cancelChat(deps, "chat-1")
    expect(session.pendingPromptSeqs).not.toContain(2)
    expect(session.pendingPromptSeqs).toContain(1)
    expect(session.pendingPromptSeqs).toContain(3)
  })

  test("increments cancelledResultPending", async () => {
    const session = makeSession({ pendingPromptSeqs: [5], cancelledResultPending: 0 })
    const claudeSessions = new Map([["chat-1", session]])
    const active = makeActiveTurn({ provider: "claude", claudePromptSeq: 5 })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, claudeSessions })
    await cancelChat(deps, "chat-1")
    expect(session.cancelledResultPending).toBe(1)
  })

  test("does not mutate session when provider is codex", async () => {
    const session = makeSession({ pendingPromptSeqs: [9], cancelledResultPending: 0 })
    const claudeSessions = new Map([["chat-1", session]])
    const active = makeActiveTurn({ provider: "codex", claudePromptSeq: 9 })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, claudeSessions })
    await cancelChat(deps, "chat-1")
    // codex provider → seq drain branch not entered
    expect(session.pendingPromptSeqs).toContain(9)
    expect(session.cancelledResultPending).toBe(0)
  })

  test("still increments cancelledResultPending when seq not in pending list", async () => {
    const session = makeSession({ pendingPromptSeqs: [1, 3], cancelledResultPending: 0 })
    const claudeSessions = new Map([["chat-1", session]])
    const active = makeActiveTurn({ provider: "claude", claudePromptSeq: 99 })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, claudeSessions })
    await cancelChat(deps, "chat-1")
    // seq 99 not in list — splice is a no-op, but cancelledResultPending still increments
    expect(session.pendingPromptSeqs).toEqual([1, 3])
    expect(session.cancelledResultPending).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// State change event
// ---------------------------------------------------------------------------

describe("state change", () => {
  test("emitStateChange is called after removing activeTurn", async () => {
    const stateChanges: string[] = []
    const active = makeActiveTurn()
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, stateChanges })
    await cancelChat(deps, "chat-1")
    expect(stateChanges).toContain("chat-1")
  })
})

// ---------------------------------------------------------------------------
// Interrupt and PTY session cleanup
// ---------------------------------------------------------------------------

describe("interrupt and close", () => {
  test("calls interrupt() and close() on the active turn", async () => {
    let interrupted = false
    let closed = false
    const turn = makeFakeTurn({
      interrupt: async () => { interrupted = true },
      close: () => { closed = true },
    })
    const active = makeActiveTurn({ turn })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns })
    await cancelChat(deps, "chat-1")
    expect(interrupted).toBe(true)
    expect(closed).toBe(true)
  })

  test("does not throw when interrupt() rejects", async () => {
    const turn = makeFakeTurn({
      interrupt: async () => { throw new Error("interrupt failed") },
    })
    const active = makeActiveTurn({ turn })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns })
    // Should not throw
    await expect(cancelChat(deps, "chat-1")).resolves.toBeUndefined()
  })

  test("closes Claude session on PTY driver for claude provider", async () => {
    const closedSessions: string[] = []
    const session = makeSession({ chatId: "chat-1" })
    const claudeSessions = new Map([["chat-1", session]])
    const active = makeActiveTurn({ provider: "claude" })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, claudeSessions, closedSessions, driver: "pty" })
    await cancelChat(deps, "chat-1")
    expect(closedSessions).toContain("chat-1")
  })

  test("does NOT close Claude session on SDK driver", async () => {
    const closedSessions: string[] = []
    const session = makeSession({ chatId: "chat-1" })
    const claudeSessions = new Map([["chat-1", session]])
    const active = makeActiveTurn({ provider: "claude" })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, claudeSessions, closedSessions, driver: "sdk" })
    await cancelChat(deps, "chat-1")
    expect(closedSessions.length).toBe(0)
  })

  test("does NOT close Claude session for codex provider even on PTY", async () => {
    const closedSessions: string[] = []
    const session = makeSession({ chatId: "chat-1" })
    const claudeSessions = new Map([["chat-1", session]])
    const active = makeActiveTurn({ provider: "codex" })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, claudeSessions, closedSessions, driver: "pty" })
    await cancelChat(deps, "chat-1")
    expect(closedSessions.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Queued messages
//
// Stop means stop: cancelling must never hand the chat straight to the next
// queued message. It used to, so with anything queued the chat went back to
// "running" in the same tick and Stop needed a second press. Queued messages
// stay parked and keep their "Send now" / "Remove" actions in the transcript.
// ---------------------------------------------------------------------------

describe("queued messages", () => {
  test("cancelling an active turn does not start the next queued message", async () => {
    const active = makeActiveTurn()
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns })

    await cancelChat(deps, "chat-1")

    // The dep is gone entirely — the cancel path has no way to start a turn.
    expect("maybeStartNextQueuedMessage" in deps).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// backgroundTaskWakeSuppressed — Stop marks the session so task-notification
// self-wakes from pre-Stop background tasks cannot re-enter the model.
// Issue #819: Stop pressed while background tasks were pending; the tasks
// later completed and triggered a self-wake that merged a PR unattended.
// ---------------------------------------------------------------------------

describe("backgroundTaskWakeSuppressed", () => {
  test("cancelling an active turn with pending background tasks sets the flag", async () => {
    const active = makeActiveTurn()
    const activeTurns = new Map([["chat-1", active]])
    const session = makeSession({
      backgroundTasks: new Map([
        ["task-1", { taskType: null, description: null, startedAt: Date.now(), outputPath: null }],
      ]),
    })
    const deps = makeDeps({ activeTurns, claudeSessions: new Map([["chat-1", session]]) })

    await cancelChat(deps, "chat-1")

    expect(session.backgroundTaskWakeSuppressed).toBe(true)
  })

  test("cancelling an active turn WITHOUT pending tasks does not set the flag", async () => {
    const active = makeActiveTurn()
    const activeTurns = new Map([["chat-1", active]])
    const session = makeSession({ backgroundTasks: new Map() })
    const deps = makeDeps({ activeTurns, claudeSessions: new Map([["chat-1", session]]) })

    await cancelChat(deps, "chat-1")

    expect(session.backgroundTaskWakeSuppressed).toBe(false)
  })

  test("cancelling a self-wake turn with pending background tasks sets the flag", async () => {
    const session = makeSession({
      selfWakeActive: true,
      backgroundTasks: new Map([
        ["task-2", { taskType: null, description: null, startedAt: Date.now(), outputPath: null }],
      ]),
    })
    session.session = { ...session.session, interrupt: async () => {} }
    const deps = makeDeps({ claudeSessions: new Map([["chat-1", session]]) })

    await cancelChat(deps, "chat-1")

    expect(session.backgroundTaskWakeSuppressed).toBe(true)
  })
})
