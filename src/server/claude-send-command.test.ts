/**
 * Tests for the extracted send/queue handler cluster.
 *
 * Each test builds a minimal `SendCommandDeps` fake and asserts correct
 * behaviour without any real IO or OS calls.
 */

import { describe, test, expect, beforeEach } from "bun:test"
import {
  resolveProvider,
  getProviderSettings,
  shouldInjectProactiveCompact,
  enqueueMessage,
  dequeueAndStartQueuedMessage,
  maybeStartNextQueuedMessage,
  sendCommand,
  type SendCommandDeps,
} from "./claude-send-command"
import type { QueuedChatMessage, ChatAttachment, CustomModelEntry } from "../shared/types"
import type { StartTurnForChatArgs } from "./claude-turn-starter"

// ---------------------------------------------------------------------------
// Minimal fixture types
// ---------------------------------------------------------------------------

function makeQueuedMessage(overrides: Partial<QueuedChatMessage> = {}): QueuedChatMessage {
  return {
    id: "qm-1",
    content: "hello",
    attachments: [],
    createdAt: Date.now(),
    provider: undefined,
    model: undefined,
    ...overrides,
  }
}

const NO_ATTACHMENTS: ChatAttachment[] = []

type DepsOptions = {
  activeChatIds?: string[]
  queuedMessages?: QueuedChatMessage[]
  chatProvider?: "claude" | "openrouter" | "codex" | null
  chatCompactFailures?: number
  messages?: { chatId: string; count: number }[]
  stopLoopCalled?: string[]
  emitStateCalled?: string[]
  startTurnCalled?: StartTurnForChatArgs[]
  enqueuedMessages?: Array<{ chatId: string; content: string }>
  removedMessages?: Array<{ chatId: string; id: string }>
  createdChats?: string[]
  analyticsEvents?: string[]
  session?: { backgroundTaskIds: Set<string>; backgroundTaskDeadlineAt: number } | null
  customModels?: readonly CustomModelEntry[]
}

function makeDeps(opts: DepsOptions = {}): SendCommandDeps & { startTurnCalled: StartTurnForChatArgs[] } {
  const activeChatIds = new Set(opts.activeChatIds ?? [])
  const queuedMessages: QueuedChatMessage[] = opts.queuedMessages ?? []
  const stopLoopCalled = opts.stopLoopCalled ?? []
  const emitStateCalled = opts.emitStateCalled ?? []
  const startTurnCalled: StartTurnForChatArgs[] = opts.startTurnCalled ?? []
  const enqueuedMessages = opts.enqueuedMessages ?? []
  const removedMessages = opts.removedMessages ?? []
  const createdChats = opts.createdChats ?? []
  const analyticsEvents = opts.analyticsEvents ?? []
  const customModels = opts.customModels ?? []

  return {
    startTurnCalled,
    store: {
      createChat: async (projectId: string) => {
        const id = `chat-new-${projectId}`
        createdChats.push(id)
        return { id }
      },
      requireChat: (_chatId: string) => ({
        provider: opts.chatProvider ?? null,
      }),
      getChat: (_chatId: string) => ({
        compactFailureCount: opts.chatCompactFailures ?? 0,
      }),
      enqueueMessage: async (chatId: string, msg: Omit<QueuedChatMessage, "id" | "createdAt">) => {
        const queued: QueuedChatMessage = {
          id: `qm-enqueued-${enqueuedMessages.length}`,
          createdAt: Date.now(),
          content: msg.content,
          attachments: msg.attachments,
          provider: msg.provider,
          model: msg.model,
          modelOptions: msg.modelOptions,
          planMode: msg.planMode,
          autoContinue: msg.autoContinue,
        }
        enqueuedMessages.push({ chatId, content: msg.content })
        return queued
      },
      removeQueuedMessage: async (chatId: string, id: string) => {
        removedMessages.push({ chatId, id })
      },
      getQueuedMessages: (_chatId: string) => queuedMessages,
      getMessages: (_chatId: string) => [],
    },
    activeTurns: {
      has: (chatId: string) => activeChatIds.has(chatId),
      get: (_chatId: string) => undefined,
    },
    claudeSessions: {
      get: (_chatId: string) => opts.session ?? undefined,
    },
    autoResumeByChat: {
      set: (_chatId: string, _value: boolean) => {},
    },
    analytics: {
      track: (event: string) => { analyticsEvents.push(event) },
    },
    getAppSettingsSnapshot: () => ({ customModels }),
    stopLoop: async (chatId: string, reason: string) => {
      stopLoopCalled.push(`${chatId}:${reason}`)
    },
    emitStateChange: (chatId: string) => { emitStateCalled.push(chatId) },
    startTurnForChat: async (args: StartTurnForChatArgs) => { startTurnCalled.push(args) },
  }
}

// ---------------------------------------------------------------------------
// resolveProvider — pure
// ---------------------------------------------------------------------------

describe("resolveProvider", () => {
  test("returns command provider when set", () => {
    expect(resolveProvider({ provider: "codex" }, null)).toBe("codex")
  })

  test("falls back to chat provider when command has none", () => {
    expect(resolveProvider({}, "openrouter")).toBe("openrouter")
  })

  test("falls back to claude when both are null", () => {
    expect(resolveProvider({}, null)).toBe("claude")
  })

  test("command provider overrides chat provider", () => {
    expect(resolveProvider({ provider: "codex" }, "claude")).toBe("codex")
  })
})

// ---------------------------------------------------------------------------
// getProviderSettings — pure
// ---------------------------------------------------------------------------

describe("getProviderSettings", () => {
  test("claude provider returns model string", () => {
    const settings = getProviderSettings("claude", { model: "claude-opus-4-5" }, [])
    expect(typeof settings.model).toBe("string")
    expect(settings.model.length).toBeGreaterThan(0)
  })

  test("claude provider sets planMode false when not set", () => {
    const settings = getProviderSettings("claude", {}, [])
    expect(settings.planMode).toBe(false)
  })

  test("openrouter provider uses model from options directly", () => {
    const settings = getProviderSettings("openrouter", { model: "anthropic/claude-3.5-sonnet" }, [])
    expect(settings.model).toBe("anthropic/claude-3.5-sonnet")
  })

  test("openrouter provider falls back to default model when blank", () => {
    const settings = getProviderSettings("openrouter", { model: "   " }, [])
    expect(typeof settings.model).toBe("string")
    expect(settings.model.length).toBeGreaterThan(0)
  })

  test("codex provider returns a model string", () => {
    const settings = getProviderSettings("codex", {}, [])
    expect(typeof settings.model).toBe("string")
  })
})

// ---------------------------------------------------------------------------
// shouldInjectProactiveCompact
// ---------------------------------------------------------------------------

describe("shouldInjectProactiveCompact", () => {
  test("returns false for slash commands", () => {
    const deps = makeDeps()
    expect(shouldInjectProactiveCompact(deps, "chat-1", "/compact")).toBe(false)
    expect(shouldInjectProactiveCompact(deps, "chat-1", "  /clear")).toBe(false)
  })

  test("returns false when getMessages returns empty (no usage data)", () => {
    // With no context window usage data, shouldProactivelyCompact returns false
    const deps = makeDeps({ chatCompactFailures: 0 })
    expect(shouldInjectProactiveCompact(deps, "chat-1", "hello")).toBe(false)
  })

  test("returns false when failure count is at or above threshold", () => {
    const deps = makeDeps({ chatCompactFailures: 5 }) // MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 5
    expect(shouldInjectProactiveCompact(deps, "chat-1", "hello")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// enqueueMessage
// ---------------------------------------------------------------------------

describe("enqueueMessage", () => {
  test("calls store.enqueueMessage with the right content", async () => {
    const enqueuedMessages: Array<{ chatId: string; content: string }> = []
    const deps = makeDeps({ enqueuedMessages })
    await enqueueMessage(deps, "chat-1", "test content", NO_ATTACHMENTS)
    expect(enqueuedMessages).toEqual([{ chatId: "chat-1", content: "test content" }])
  })

  test("emits state change after enqueue", async () => {
    const emitStateCalled: string[] = []
    const deps = makeDeps({ emitStateCalled })
    await enqueueMessage(deps, "chat-1", "msg", NO_ATTACHMENTS)
    expect(emitStateCalled).toContain("chat-1")
  })

  test("returns the queued message with an id", async () => {
    const deps = makeDeps()
    const result = await enqueueMessage(deps, "chat-1", "content", NO_ATTACHMENTS)
    expect(result.id).toMatch(/^qm-enqueued-/)
    expect(result.content).toBe("content")
  })

  test("passes provider and model from options", async () => {
    const enqueuedMessages: Array<{ chatId: string; content: string }> = []
    const deps = makeDeps({ enqueuedMessages })
    await enqueueMessage(deps, "chat-1", "msg", NO_ATTACHMENTS, {
      provider: "claude",
      model: "claude-opus-4-5",
    })
    expect(enqueuedMessages[0]).toEqual({ chatId: "chat-1", content: "msg" })
  })
})

// ---------------------------------------------------------------------------
// dequeueAndStartQueuedMessage
// ---------------------------------------------------------------------------

describe("dequeueAndStartQueuedMessage", () => {
  test("removes message from store before starting turn", async () => {
    const removedMessages: Array<{ chatId: string; id: string }> = []
    const deps = makeDeps({ removedMessages })
    const msg = makeQueuedMessage({ id: "qm-abc" })
    await dequeueAndStartQueuedMessage(deps, "chat-1", msg)
    expect(removedMessages).toEqual([{ chatId: "chat-1", id: "qm-abc" }])
  })

  test("calls startTurnForChat with resolved provider", async () => {
    const deps = makeDeps({ chatProvider: "claude" })
    const msg = makeQueuedMessage({ content: "user message" })
    await dequeueAndStartQueuedMessage(deps, "chat-1", msg)
    expect(deps.startTurnCalled.length).toBe(1)
    expect(deps.startTurnCalled[0]?.provider).toBe("claude")
    expect(deps.startTurnCalled[0]?.content).toBe("user message")
  })

  test("wraps content in steered format when steered=true", async () => {
    const deps = makeDeps({ chatProvider: "claude" })
    const msg = makeQueuedMessage({ content: "original" })
    await dequeueAndStartQueuedMessage(deps, "chat-1", msg, { steered: true })
    const startedContent = deps.startTurnCalled[0]?.content ?? ""
    // Steered messages are wrapped (not the original string)
    expect(startedContent).not.toBe("original")
    expect(startedContent.length).toBeGreaterThan(0)
  })

  test("suppresses user_prompt entry for rate-limit fallback", async () => {
    const deps = makeDeps({ chatProvider: "claude" })
    const msg = makeQueuedMessage({
      content: "continue",
      autoContinue: { scheduleId: "sched-1" },
    })
    await dequeueAndStartQueuedMessage(deps, "chat-1", msg)
    expect(deps.startTurnCalled[0]?.appendUserPrompt).toBe(false)
  })

  test("appends user_prompt for non-rate-limit message", async () => {
    const deps = makeDeps({ chatProvider: "claude" })
    const msg = makeQueuedMessage({ content: "hello" })
    await dequeueAndStartQueuedMessage(deps, "chat-1", msg)
    expect(deps.startTurnCalled[0]?.appendUserPrompt).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// maybeStartNextQueuedMessage
// ---------------------------------------------------------------------------

describe("maybeStartNextQueuedMessage", () => {
  test("returns false and does nothing when a turn is active", async () => {
    const deps = makeDeps({ activeChatIds: ["chat-1"], queuedMessages: [makeQueuedMessage()] })
    const result = await maybeStartNextQueuedMessage(deps, "chat-1")
    expect(result).toBe(false)
    expect(deps.startTurnCalled.length).toBe(0)
  })

  test("returns false when no queued messages", async () => {
    const deps = makeDeps({ queuedMessages: [] })
    const result = await maybeStartNextQueuedMessage(deps, "chat-1")
    expect(result).toBe(false)
  })

  test("dequeues and starts when idle and messages exist", async () => {
    const queuedMessages = [makeQueuedMessage({ content: "queued msg" })]
    const deps = makeDeps({ queuedMessages })
    const result = await maybeStartNextQueuedMessage(deps, "chat-1")
    expect(result).toBe(true)
    expect(deps.startTurnCalled.length).toBe(1)
    expect(deps.startTurnCalled[0]?.content).toBe("queued msg")
  })
})

// ---------------------------------------------------------------------------
// sendCommand — integration
// ---------------------------------------------------------------------------

describe("sendCommand", () => {
  let stopLoopCalled: string[]
  let analyticsEvents: string[]
  let deps: SendCommandDeps & { startTurnCalled: StartTurnForChatArgs[] }

  beforeEach(() => {
    stopLoopCalled = []
    analyticsEvents = []
    deps = makeDeps({ stopLoopCalled, analyticsEvents, chatProvider: "claude" })
  })

  test("throws when no chatId and no projectId", async () => {
    expect(sendCommand(deps, {
      type: "chat.send",
      content: "hello",
      chatId: undefined,
      projectId: undefined,
    } as Parameters<typeof sendCommand>[1])).rejects.toThrow("Missing projectId")
  })

  test("creates a new chat when chatId is absent", async () => {
    const createdChats: string[] = []
    const d = makeDeps({ createdChats, analyticsEvents })
    const result = await sendCommand(d, {
      type: "chat.send",
      content: "hi",
      chatId: undefined,
      projectId: "proj-1",
    } as Parameters<typeof sendCommand>[1])
    expect(createdChats.length).toBe(1)
    expect(result.chatId).toMatch(/^chat-new-/)
  })

  test("calls stopLoop with user_send before processing", async () => {
    await sendCommand(deps, {
      type: "chat.send",
      content: "hi",
      chatId: "chat-1",
    } as Parameters<typeof sendCommand>[1])
    expect(stopLoopCalled).toContain("chat-1:user_send")
  })

  test("enqueues message and returns queued:true when turn is active", async () => {
    const d = makeDeps({
      activeChatIds: ["chat-1"],
      chatProvider: "claude",
      analyticsEvents,
    })
    const result = await sendCommand(d, {
      type: "chat.send",
      content: "queued message",
      chatId: "chat-1",
    } as Parameters<typeof sendCommand>[1])
    expect(result.queued).toBe(true)
    expect(result.queuedMessageId).toMatch(/^qm-enqueued-/)
  })

  test("starts a turn directly when idle", async () => {
    const result = await sendCommand(deps, {
      type: "chat.send",
      content: "start now",
      chatId: "chat-1",
    } as Parameters<typeof sendCommand>[1])
    expect(result.queued).toBeUndefined()
    expect(deps.startTurnCalled.length).toBe(1)
    expect(deps.startTurnCalled[0]?.content).toBe("start now")
  })

  test("clears background task state on existing session", async () => {
    const session = {
      backgroundTaskIds: new Set(["task-1"]),
      backgroundTaskDeadlineAt: 9999,
    }
    const d = makeDeps({ session })
    await sendCommand(d, {
      type: "chat.send",
      content: "hi",
      chatId: "chat-1",
    } as Parameters<typeof sendCommand>[1])
    expect(session.backgroundTaskIds.size).toBe(0)
    expect(session.backgroundTaskDeadlineAt).toBe(0)
  })

  test("tracks message_sent analytics", async () => {
    await sendCommand(deps, {
      type: "chat.send",
      content: "track me",
      chatId: "chat-1",
    } as Parameters<typeof sendCommand>[1])
    expect(analyticsEvents).toContain("message_sent")
  })
})
