import { describe, expect, test } from "bun:test"
import { AGENT_PROVIDERS, type AgentProvider } from "../shared/core-types"
import type { TranscriptEntry } from "../shared/types"
import type { ClaudeSessionState } from "./claude-session-state"
import { buildHistoryPrimer } from "./history-primer"
import {
  clearChatContext,
  clearClaudeSessionContext,
  type ClearChatContextDeps,
} from "./claude-context-commands"

interface Harness {
  deps: ClearChatContextDeps
  tokenWrites: { provider: AgentProvider; token: string | null }[]
  appended: TranscriptEntry[]
  closedChatIds: string[]
  stoppedCodexChatIds: string[]
  stateChanges: string[]
  session: ClaudeSessionState | undefined
}

function makeHarness(options?: {
  session?: Partial<ClaudeSessionState>
  hasActiveTurn?: boolean
  hasStartingTurn?: boolean
  hasPendingTool?: boolean
  hasLiveWorkflow?: boolean
  hasPendingBackgroundTask?: boolean
}): Harness {
  const tokenWrites: { provider: AgentProvider; token: string | null }[] = []
  const appended: TranscriptEntry[] = []
  const closedChatIds: string[] = []
  const stoppedCodexChatIds: string[] = []
  const stateChanges: string[] = []

  const session = options?.session
    ? ({
        suppressSessionTokenPersist: false,
        pendingPromptSeqs: [],
        selfWakeActive: false,
        ...options.session,
      } as ClaudeSessionState)
    : undefined

  return {
    tokenWrites,
    appended,
    closedChatIds,
    stoppedCodexChatIds,
    stateChanges,
    session,
    deps: {
      store: {
        setSessionTokenForProvider: async (_chatId, provider, token) => {
          tokenWrites.push({ provider, token })
        },
        appendMessage: async (_chatId, entry) => { appended.push(entry) },
      },
      claudeSessions: { get: () => session },
      activeTurns: { has: () => options?.hasActiveTurn === true },
      startingTurns: { has: () => options?.hasStartingTurn === true },
      pendingTools: { has: () => options?.hasPendingTool === true },
      hasLiveWorkflow: () => options?.hasLiveWorkflow === true,
      hasPendingBackgroundTask: () => options?.hasPendingBackgroundTask === true,
      closeClaudeSession: (chatId) => { closedChatIds.push(chatId) },
      stopCodexSession: (chatId) => { stoppedCodexChatIds.push(chatId) },
      emitStateChange: (chatId) => { stateChanges.push(chatId) },
    },
  }
}

describe("clearChatContext", () => {
  test("nulls the session token for every provider", async () => {
    const h = makeHarness()

    await clearChatContext(h.deps, "chat-1")

    expect(h.tokenWrites.map((w) => w.provider).sort()).toEqual([...AGENT_PROVIDERS].sort())
    expect(h.tokenWrites.every((w) => w.token === null)).toBe(true)
  })

  test("stops the codex session — a live one is reused regardless of token", async () => {
    const h = makeHarness()

    await clearChatContext(h.deps, "chat-1")

    expect(h.stoppedCodexChatIds).toEqual(["chat-1"])
  })

  test("suppresses session-token persist on a live claude session", async () => {
    const h = makeHarness({ session: {} })

    await clearChatContext(h.deps, "chat-1")

    expect(h.session?.suppressSessionTokenPersist).toBe(true)
  })

  test("closes an idle claude session so the next turn cannot reuse it", async () => {
    const h = makeHarness({ session: {} })

    await clearChatContext(h.deps, "chat-1")

    expect(h.closedChatIds).toEqual(["chat-1"])
  })

  test("does not close a claude session that has an active turn", async () => {
    const h = makeHarness({ session: {}, hasActiveTurn: true })

    await clearChatContext(h.deps, "chat-1")

    expect(h.closedChatIds).toEqual([])
    expect(h.session?.suppressSessionTokenPersist).toBe(true)
  })

  test("does not close a claude session whose turn is still booting", async () => {
    const h = makeHarness({ session: {}, hasStartingTurn: true })

    await clearChatContext(h.deps, "chat-1")

    expect(h.closedChatIds).toEqual([])
    expect(h.session?.suppressSessionTokenPersist).toBe(true)
  })

  test("appends exactly one context_cleared entry", async () => {
    const h = makeHarness()

    await clearChatContext(h.deps, "chat-1")

    expect(h.appended).toHaveLength(1)
    expect(h.appended[0].kind).toBe("context_cleared")
  })

  test("appends the marker only after every token is wiped", async () => {
    const order: string[] = []
    const h = makeHarness()
    h.deps.store.setSessionTokenForProvider = async () => { order.push("token") }
    h.deps.store.appendMessage = async () => { order.push("append") }

    await clearChatContext(h.deps, "chat-1")

    expect(order.lastIndexOf("token")).toBeLessThan(order.indexOf("append"))
  })

  test("emits a state change", async () => {
    const h = makeHarness()

    await clearChatContext(h.deps, "chat-1")

    expect(h.stateChanges).toEqual(["chat-1"])
  })
})

describe("clearClaudeSessionContext", () => {
  test("touches only the claude token — the loop path is claude-only", async () => {
    const h = makeHarness({ session: {} })

    await clearClaudeSessionContext(h.deps, "chat-1")

    expect(h.tokenWrites).toEqual([{ provider: "claude", token: null }])
    expect(h.stoppedCodexChatIds).toEqual([])
    expect(h.appended).toEqual([])
  })

  test("is a no-op beyond the token write when no session is live", async () => {
    const h = makeHarness()

    await clearClaudeSessionContext(h.deps, "chat-1")

    expect(h.closedChatIds).toEqual([])
  })

  test("does not close when a pending tool is parked (canUseTool worker is blocked)", async () => {
    const h = makeHarness({ session: {}, hasPendingTool: true })

    await clearClaudeSessionContext(h.deps, "chat-1")

    expect(h.closedChatIds).toEqual([])
    expect(h.session?.suppressSessionTokenPersist).toBe(true)
  })

  test("does not close when the chat has a live workflow", async () => {
    const h = makeHarness({ session: {}, hasLiveWorkflow: true })

    await clearClaudeSessionContext(h.deps, "chat-1")

    expect(h.closedChatIds).toEqual([])
  })

  test("does not close when a background task is pending", async () => {
    const h = makeHarness({ session: {}, hasPendingBackgroundTask: true })

    await clearClaudeSessionContext(h.deps, "chat-1")

    expect(h.closedChatIds).toEqual([])
  })

  test("does not close when pendingPromptSeqs is non-empty", async () => {
    const h = makeHarness({ session: { pendingPromptSeqs: [1] } as Partial<ClaudeSessionState> })

    await clearClaudeSessionContext(h.deps, "chat-1")

    expect(h.closedChatIds).toEqual([])
  })

  test("does not close when a self-wake turn is active", async () => {
    const h = makeHarness({ session: { selfWakeActive: true } as Partial<ClaudeSessionState> })

    await clearClaudeSessionContext(h.deps, "chat-1")

    expect(h.closedChatIds).toEqual([])
  })
})

describe("clearChatContext → next turn's context", () => {
  test("what /clear writes is what makes the next turn's primer empty", async () => {
    const transcript: TranscriptEntry[] = [
      { _id: "u1", createdAt: 1000, kind: "user_prompt", content: "the old task" },
      { _id: "a1", createdAt: 2000, kind: "assistant_text", text: "SECRET_EARLIER_DETAIL" },
    ]
    const h = makeHarness()
    h.deps.store.appendMessage = async (_chatId, entry) => { transcript.push(entry) }

    await clearChatContext(h.deps, "chat-1")

    expect(buildHistoryPrimer(transcript, "claude", "what now?")).toBeNull()
  })
})
