/**
 * Tests for the extracted cancelChat standalone function.
 *
 * Each test builds a minimal `CancelHandlerDeps` fake and asserts the
 * correct behaviour without any real IO or OS calls.
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { cancelChat, type CancelHandlerDeps } from "./claude-cancel-handler"
import type { ActiveTurn, ClaudeSessionState } from "./claude-session-state"
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
    model: "claude-opus-4",
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

function makeSession(overrides: Partial<ClaudeSessionState> = {}): ClaudeSessionState {
  return {
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
    backgroundTaskIds: new Set<string>(),
    backgroundTaskDeadlineAt: 0,
    loopArmedAtSpawn: false,
    workflowsDirRegistered: false,
    cancelledResultPending: 0,
    suppressSessionTokenPersist: false,
    ...overrides,
  }
}

type DepOverrides = {
  drainingStreams?: Map<string, { turn: HarnessTurn }>
  activeTurns?: Map<string, ActiveTurn>
  claudeSessions?: Map<string, ClaudeSessionState>
  appendedMessages?: TranscriptEntry[]
  turnCancelledFor?: string[]
  stateChanges?: string[]
  rejectCalled?: string[]
  orchestratorCancelled?: string[]
  closedSessions?: string[]
  queueDrained?: string[]
  driver?: "sdk" | "pty"
}

function makeDeps(overrides: DepOverrides = {}): CancelHandlerDeps {
  const drainingStreams: Map<string, { turn: HarnessTurn }> = overrides.drainingStreams ?? new Map()
  const activeTurns: Map<string, ActiveTurn> = overrides.activeTurns ?? new Map()
  const claudeSessions: Map<string, ClaudeSessionState> = overrides.claudeSessions ?? new Map()
  const appendedMessages = overrides.appendedMessages ?? []
  const turnCancelledFor = overrides.turnCancelledFor ?? []
  const stateChanges = overrides.stateChanges ?? []
  const rejectCalled = overrides.rejectCalled ?? []
  const orchestratorCancelled = overrides.orchestratorCancelled ?? []
  const closedSessions = overrides.closedSessions ?? []
  const queueDrained = overrides.queueDrained ?? []
  const driver = overrides.driver ?? "sdk"

  return {
    drainingStreams,
    rejectPendingResolversForChat: (chatId) => { rejectCalled.push(chatId) },
    cancelChatInOrchestrator: (chatId) => { orchestratorCancelled.push(chatId) },
    activeTurns,
    store: {
      appendMessage: async (_chatId, entry) => { appendedMessages.push(entry) },
      recordTurnCancelled: async (chatId) => { turnCancelledFor.push(chatId) },
    },
    claudeSessions,
    emitStateChange: (chatId) => { stateChanges.push(chatId) },
    resolveClaudeDriverPreference: () => driver,
    closeClaudeSession: (chatId) => { closedSessions.push(chatId) },
    maybeStartNextQueuedMessage: async (chatId) => { queueDrained.push(chatId) },
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

  test("queue is not drained when no active turn", async () => {
    const queueDrained: string[] = []
    const deps = makeDeps({ queueDrained })
    await cancelChat(deps, "chat-1")
    expect(queueDrained.length).toBe(0)
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
  test("appends tool_result entry when pendingTool is set", async () => {
    const appendedMessages: TranscriptEntry[] = []
    const active = makeActiveTurn({
      pendingTool: {
        toolUseId: "tool-use-1",
        tool: {
          kind: "tool",
          toolKind: "ask_user_question",
          toolName: "AskUserQuestion",
          toolId: "tool-use-1",
          input: { questions: [] },
        },
        resolve: () => {},
      },
    })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, appendedMessages })
    await cancelChat(deps, "chat-1")
    const toolResult = appendedMessages.find((m) => m.kind === "tool_result")
    expect(toolResult).toBeDefined()
    expect((toolResult as { toolId?: string })?.toolId).toBe("tool-use-1")
  })

  test("resolves pendingTool when provider=codex and toolKind=exit_plan_mode", async () => {
    let resolved: unknown = undefined
    const active = makeActiveTurn({
      provider: "codex",
      pendingTool: {
        toolUseId: "tool-use-2",
        tool: {
          kind: "tool",
          toolKind: "exit_plan_mode",
          toolName: "ExitPlanMode",
          toolId: "tool-use-2",
          input: {},
        },
        resolve: (result) => { resolved = result },
      },
    })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns })
    await cancelChat(deps, "chat-1")
    expect(resolved).toMatchObject({ discarded: true })
  })

  test("does NOT resolve pendingTool when provider=claude (non-codex)", async () => {
    let resolved = false
    const active = makeActiveTurn({
      provider: "claude",
      pendingTool: {
        toolUseId: "tool-use-3",
        tool: {
          kind: "tool",
          toolKind: "exit_plan_mode",
          toolName: "ExitPlanMode",
          toolId: "tool-use-3",
          input: {},
        },
        resolve: () => { resolved = true },
      },
    })
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns })
    await cancelChat(deps, "chat-1")
    expect(resolved).toBe(false)
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
// Queue drain options
// ---------------------------------------------------------------------------

describe("queue drain", () => {
  test("drains queue by default", async () => {
    const queueDrained: string[] = []
    const active = makeActiveTurn()
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, queueDrained })
    await cancelChat(deps, "chat-1")
    expect(queueDrained).toContain("chat-1")
  })

  test("skips queue drain when skipQueueDrain is true", async () => {
    const queueDrained: string[] = []
    const active = makeActiveTurn()
    const activeTurns = new Map([["chat-1", active]])
    const deps = makeDeps({ activeTurns, queueDrained })
    await cancelChat(deps, "chat-1", { skipQueueDrain: true })
    expect(queueDrained.length).toBe(0)
  })
})
