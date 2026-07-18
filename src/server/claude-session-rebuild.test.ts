/**
 * Tests for claude-session-rebuild.ts helpers.
 *
 * Uses fake/stub deps so no real IO is involved. Covers both exported
 * functions: recreateActiveTurnFromSession and findLastUserMessageId.
 */
import { describe, test, expect } from "bun:test"
import {
  findLastUserMessageId,
  recreateActiveTurnFromSession,
  type SessionRebuildDeps,
} from "./claude-session-rebuild"
import type { ClaudeSessionState, ActiveTurn } from "./claude-session-state"
import type { MessageEntry } from "./claude-session-rebuild"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<ClaudeSessionState> = {}): ClaudeSessionState {
  return {
    id: "session-1",
    chatId: "chat-1",
    session: {
      provider: "claude",
      stream: {
        async *[Symbol.asyncIterator]() {},
      },
      getAccountInfo: async () => null,
      interrupt: async () => {},
      close: () => {},
      sendPrompt: async () => {},
      setModel: async () => {},
      setPermissionMode: async () => {},
      getSupportedCommands: async () => [],
    },
    localPath: "/tmp/test",
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
    lastUsedAt: 0,
    backgroundTaskIds: new Set(),
    backgroundTaskDeadlineAt: 0,
    // loopArmedAtSpawn is optional per the type - omit it
    ...overrides,
  } as ClaudeSessionState
}

function makeDeps(overrides: {
  claudeSessions?: Map<string, ClaudeSessionState>
  activeTurns?: Map<string, ActiveTurn>
  providerUsesSdkSession?: (p: string) => boolean
  messages?: MessageEntry[]
} = {}): SessionRebuildDeps {
  return {
    claudeSessions: overrides.claudeSessions ?? new Map(),
    activeTurns: overrides.activeTurns ?? new Map(),
    providerUsesSdkSession: overrides.providerUsesSdkSession ?? (() => true),
    getMessages: (_chatId) => overrides.messages ?? [],
  }
}

// ---------------------------------------------------------------------------
// findLastUserMessageId
// ---------------------------------------------------------------------------

describe("findLastUserMessageId", () => {
  test("returns null when transcript is empty", () => {
    const deps = makeDeps({ messages: [] })
    expect(findLastUserMessageId(deps, "chat-1")).toBeNull()
  })

  test("returns null when no user_prompt entry exists", () => {
    const deps = makeDeps({
      messages: [
        { kind: "assistant_text", _id: "a1" },
        { kind: "result", _id: "r1" },
      ],
    })
    expect(findLastUserMessageId(deps, "chat-1")).toBeNull()
  })

  test("returns _id of the last user_prompt entry", () => {
    const deps = makeDeps({
      messages: [
        { kind: "user_prompt", _id: "u1" },
        { kind: "assistant_text", _id: "a1" },
        { kind: "user_prompt", _id: "u2" },
        { kind: "result", _id: "r1" },
      ],
    })
    expect(findLastUserMessageId(deps, "chat-1")).toBe("u2")
  })

  test("returns the only user_prompt _id when there is exactly one", () => {
    const deps = makeDeps({
      messages: [
        { kind: "user_prompt", _id: "u1" },
        { kind: "assistant_text", _id: "a1" },
      ],
    })
    expect(findLastUserMessageId(deps, "chat-1")).toBe("u1")
  })
})

// ---------------------------------------------------------------------------
// recreateActiveTurnFromSession
// ---------------------------------------------------------------------------

describe("recreateActiveTurnFromSession", () => {
  test("returns undefined when provider does not use SDK session", () => {
    const deps = makeDeps({ providerUsesSdkSession: () => false })
    const result = recreateActiveTurnFromSession(deps, {
      chatId: "chat-1",
      provider: "codex",
      model: "o3",
      planMode: false,
    })
    expect(result).toBeUndefined()
  })

  test("returns undefined when no live session exists for the chat", () => {
    const deps = makeDeps({
      claudeSessions: new Map(), // empty — no session for chat-1
      providerUsesSdkSession: () => true,
    })
    const result = recreateActiveTurnFromSession(deps, {
      chatId: "chat-1",
      provider: "claude",
      model: "claude-opus-4-5",
      planMode: false,
    })
    expect(result).toBeUndefined()
  })

  test("returns an ActiveTurn and stores it in activeTurns when session exists", () => {
    const session = makeSession({ chatId: "chat-1", model: "claude-opus-4-5", planMode: false })
    const claudeSessions = new Map([["chat-1", session]])
    const activeTurns = new Map<string, ActiveTurn>()
    const deps = makeDeps({
      claudeSessions,
      activeTurns,
      providerUsesSdkSession: () => true,
      messages: [{ kind: "user_prompt", _id: "u1" }],
    })

    const result = recreateActiveTurnFromSession(deps, {
      chatId: "chat-1",
      provider: "claude",
      model: "claude-opus-4-5",
      planMode: false,
      clientTraceId: "trace-abc",
    })

    expect(result).toBeDefined()
    if (!result) throw new Error("Expected ActiveTurn")
    expect(result.chatId).toBe("chat-1")
    expect(result.provider).toBe("claude")
    expect(result.model).toBe("claude-opus-4-5")
    expect(result.planMode).toBe(false)
    expect(result.status).toBe("waiting_for_user")
    expect(result.pendingTool).toBeNull()
    expect(result.hasFinalResult).toBe(false)
    expect(result.cancelRequested).toBe(false)
    expect(result.clientTraceId).toBe("trace-abc")
    expect(result.userMessageId).toBe("u1")
    expect(activeTurns.get("chat-1")).toBe(result)
  })

  test("sets userMessageId to null when no user_prompt in transcript", () => {
    const session = makeSession({ chatId: "chat-2" })
    const claudeSessions = new Map([["chat-2", session]])
    const activeTurns = new Map<string, ActiveTurn>()
    const deps = makeDeps({
      claudeSessions,
      activeTurns,
      providerUsesSdkSession: () => true,
      messages: [],
    })

    const result = recreateActiveTurnFromSession(deps, {
      chatId: "chat-2",
      provider: "claude",
      model: "claude-opus-4-5",
      planMode: false,
    })

    expect(result?.userMessageId).toBeNull()
  })

  test("ghost turn stream is an empty async iterable", async () => {
    const session = makeSession({ chatId: "chat-3" })
    const claudeSessions = new Map([["chat-3", session]])
    const deps = makeDeps({
      claudeSessions,
      activeTurns: new Map(),
      providerUsesSdkSession: () => true,
    })

    const result = recreateActiveTurnFromSession(deps, {
      chatId: "chat-3",
      provider: "claude",
      model: "claude-opus-4-5",
      planMode: false,
    })

    expect(result).toBeDefined()
    const events: unknown[] = []
    for await (const ev of result!.turn.stream) {
      events.push(ev)
    }
    expect(events).toHaveLength(0)
  })
})
