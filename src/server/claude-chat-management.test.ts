
import { describe, it, expect, vi } from "vite-plus/test"
import {
  stopDraining,
  closeChat,
  steer,
  dequeue,
  forkChat,
  generateTitleInBackground,
  type ChatManagementDeps,
} from "./claude-chat-management"
import type { QueuedChatMessage } from "../shared/types"


function makeQueuedMessage(overrides?: Partial<QueuedChatMessage>): QueuedChatMessage {
  return {
    id: "msg-1",
    content: "hello",
    attachments: [],
    createdAt: 0,
    provider: "claude",
    model: "claude-opus-4-5",
    planMode: false,
    ...overrides,
  }
}

function makeDeps(overrides?: Partial<ChatManagementDeps>): ChatManagementDeps {
  return {
    activeTurns: {
      has: vi.fn(() => false),
      get: vi.fn(() => undefined),
    },
    drainingStreams: {
      get: vi.fn(() => undefined),
      has: vi.fn(() => false),
      delete: vi.fn(() => false),
    },
    claudeSessions: {
      get: vi.fn(() => undefined),
    },
    autoResumeByChat: {
      delete: vi.fn(() => false),
    },
    store: {
      getQueuedMessage: vi.fn((_chatId: string, _id: string) => null),
      removeQueuedMessage: vi.fn(async () => {}),
      requireChat: vi.fn((_chatId: string) => ({
        title: "Chat title",
        provider: "claude" as const,
        sessionTokensByProvider: { claude: "tok-123" },
        pendingForkSessionToken: null,
      })),
      forkChat: vi.fn(async (_chatId: string) => ({ id: "forked-id" })),
      renameChat: vi.fn(async () => {}),
    },
    analytics: {
      track: vi.fn(() => {}),
    },
    cancel: vi.fn(async () => {}),
    closeClaudeSession: vi.fn(() => {}),
    emitStateChange: vi.fn(() => {}),
    generateTitle: vi.fn(async () => ({ title: "New Title", usedFallback: false, failureMessage: null })),
    reportBackgroundError: null,
    dequeueAndStartQueuedMessage: vi.fn(async () => {}),
    ...overrides,
  }
}


describe("stopDraining", () => {
  it("is a no-op when no draining stream exists", async () => {
    const deps = makeDeps()
    await stopDraining(deps, "chat-1")
    expect(deps.emitStateChange).not.toHaveBeenCalled()
    expect(deps.drainingStreams.delete).not.toHaveBeenCalled()
  })

  it("closes the turn, removes the stream, and emits state change", async () => {
    const close = vi.fn(() => {})
    const deps = makeDeps({
      drainingStreams: {
        get: vi.fn(() => ({ turn: { close } })),
        has: vi.fn(() => true),
        delete: vi.fn(() => true),
      },
    })
    await stopDraining(deps, "chat-1")
    expect(close).toHaveBeenCalledTimes(1)
    expect(deps.drainingStreams.delete).toHaveBeenCalledWith("chat-1")
    expect(deps.emitStateChange).toHaveBeenCalledWith("chat-1")
  })
})


describe("closeChat", () => {
  it("stops draining, clears auto-resume, and emits state change", async () => {
    const deps = makeDeps()
    await closeChat(deps, "chat-1")
    expect(deps.autoResumeByChat.delete).toHaveBeenCalledWith("chat-1")
    expect(deps.emitStateChange).toHaveBeenCalledWith("chat-1")
  })

  it("closes the claude session when one exists", async () => {
    const fakeSession = { sessionId: "s1" } as never
    const deps = makeDeps({
      claudeSessions: { get: vi.fn(() => fakeSession) },
    })
    await closeChat(deps, "chat-1")
    expect(deps.closeClaudeSession).toHaveBeenCalledWith("chat-1", fakeSession)
  })

  it("skips closeClaudeSession when no session exists", async () => {
    const deps = makeDeps()
    await closeChat(deps, "chat-1")
    expect(deps.closeClaudeSession).not.toHaveBeenCalled()
  })
})


describe("steer", () => {
  it("throws when queued message not found", async () => {
    const deps = makeDeps()
    await expect(
      steer(deps, { type: "message.steer", chatId: "c1", queuedMessageId: "qm-1" }),
    ).rejects.toThrow("Queued message not found")
  })

  it("cancels active turn then dequeues when chat is active", async () => {
    const qm = makeQueuedMessage()
    let hasCallCount = 0
    const cancelFn = vi.fn(async () => {})
    const dequeueStartFn = vi.fn(async () => {})
    const deps: ChatManagementDeps = {
      ...makeDeps(),
      activeTurns: {
        has: (_chatId: string) => hasCallCount++ < 2,
        get: () => undefined,
      },
      store: {
        ...makeDeps().store,
        getQueuedMessage: (_chatId: string, _id: string) => qm,
      },
      cancel: cancelFn,
      dequeueAndStartQueuedMessage: dequeueStartFn,
    }

    await steer(deps, { type: "message.steer", chatId: "c1", queuedMessageId: "qm-1" })
    expect(cancelFn).toHaveBeenCalledWith("c1", { hideInterrupted: true })
    expect(dequeueStartFn).toHaveBeenCalledWith("c1", qm, { steered: true })
  })

  it("throws when chat is still active after cancel", async () => {
    const qm = makeQueuedMessage()
    const deps: ChatManagementDeps = {
      ...makeDeps(),
      activeTurns: {
        has: () => true,
        get: () => undefined,
      },
      store: {
        ...makeDeps().store,
        getQueuedMessage: (_chatId: string, _id: string) => qm,
      },
    }
    await expect(
      steer(deps, { type: "message.steer", chatId: "c1", queuedMessageId: "qm-1" }),
    ).rejects.toThrow("Chat is still running")
  })
})


describe("dequeue", () => {
  it("throws when queued message not found", async () => {
    const deps = makeDeps()
    await expect(
      dequeue(deps, { type: "message.dequeue", chatId: "c1", queuedMessageId: "qm-1" }),
    ).rejects.toThrow("Queued message not found")
  })

  it("throws when proactive compact is running", async () => {
    const qm = makeQueuedMessage()
    const deps = makeDeps({
      activeTurns: {
        has: vi.fn(() => true),
        get: vi.fn(() => ({ compactionTurn: "proactive" as const })),
      },
      store: {
        getQueuedMessage: vi.fn(() => qm),
        removeQueuedMessage: vi.fn(async () => {}),
        requireChat: vi.fn(() => ({ title: "", provider: null, sessionTokensByProvider: {}, pendingForkSessionToken: null })),
        forkChat: vi.fn(async () => ({ id: "" })),
        renameChat: vi.fn(async () => {}),
      },
    })
    await expect(
      dequeue(deps, { type: "message.dequeue", chatId: "c1", queuedMessageId: "qm-1" }),
    ).rejects.toThrow("Cannot remove queued message while compact is running")
  })

  it("removes the queued message when safe", async () => {
    const qm = makeQueuedMessage()
    const deps = makeDeps({
      store: {
        getQueuedMessage: vi.fn(() => qm),
        removeQueuedMessage: vi.fn(async () => {}),
        requireChat: vi.fn(() => ({ title: "", provider: null, sessionTokensByProvider: {}, pendingForkSessionToken: null })),
        forkChat: vi.fn(async () => ({ id: "" })),
        renameChat: vi.fn(async () => {}),
      },
    })
    await dequeue(deps, { type: "message.dequeue", chatId: "c1", queuedMessageId: "qm-1" })
    expect(deps.store.removeQueuedMessage).toHaveBeenCalledWith("c1", "qm-1")
  })
})


describe("forkChat", () => {
  it("throws when chat is active", async () => {
    const deps = makeDeps({
      activeTurns: { has: vi.fn(() => true), get: vi.fn(() => undefined) },
    })
    await expect(forkChat(deps, "c1")).rejects.toThrow("Chat must be idle before forking")
  })

  it("throws when chat is draining", async () => {
    const deps = makeDeps({
      drainingStreams: { has: vi.fn(() => true), get: vi.fn(() => undefined), delete: vi.fn(() => false) },
    })
    await expect(forkChat(deps, "c1")).rejects.toThrow("Chat must be idle before forking")
  })

  it("throws when chat has no provider", async () => {
    const deps = makeDeps({
      store: {
        getQueuedMessage: vi.fn(() => null),
        removeQueuedMessage: vi.fn(async () => {}),
        requireChat: vi.fn(() => ({ title: "", provider: null, sessionTokensByProvider: {}, pendingForkSessionToken: null })),
        forkChat: vi.fn(async () => ({ id: "" })),
        renameChat: vi.fn(async () => {}),
      },
    })
    await expect(forkChat(deps, "c1")).rejects.toThrow("Chat must have a provider before forking")
  })

  it("throws when chat has no session token", async () => {
    const deps = makeDeps({
      store: {
        getQueuedMessage: vi.fn(() => null),
        removeQueuedMessage: vi.fn(async () => {}),
        requireChat: vi.fn(() => ({
          title: "",
          provider: "claude" as const,
          sessionTokensByProvider: { claude: null },
          pendingForkSessionToken: null,
        })),
        forkChat: vi.fn(async () => ({ id: "" })),
        renameChat: vi.fn(async () => {}),
      },
    })
    await expect(forkChat(deps, "c1")).rejects.toThrow("Chat has no session to fork")
  })

  it("forks and tracks analytics on success", async () => {
    const deps = makeDeps()
    const result = await forkChat(deps, "c1")
    expect(result).toEqual({ chatId: "forked-id" })
    expect(deps.analytics.track).toHaveBeenCalledWith("chat_created")
  })

  it("accepts pendingForkSessionToken as the fork source", async () => {
    const deps = makeDeps({
      store: {
        getQueuedMessage: vi.fn(() => null),
        removeQueuedMessage: vi.fn(async () => {}),
        requireChat: vi.fn(() => ({
          title: "",
          provider: "claude" as const,
          sessionTokensByProvider: { claude: null },
          pendingForkSessionToken: { provider: "claude" as const, token: "pending-tok" },
        })),
        forkChat: vi.fn(async () => ({ id: "forked-2" })),
        renameChat: vi.fn(async () => {}),
      },
    })
    const result = await forkChat(deps, "c1")
    expect(result).toEqual({ chatId: "forked-2" })
  })
})


describe("generateTitleInBackground", () => {
  it("renames chat when title generation succeeds and title still matches", async () => {
    const deps = makeDeps({
      generateTitle: vi.fn(async () => ({ title: "AI Title", usedFallback: false, failureMessage: null })),
      store: {
        getQueuedMessage: vi.fn(() => null),
        removeQueuedMessage: vi.fn(async () => {}),
        requireChat: vi.fn(() => ({
          title: "original",
          provider: null,
          sessionTokensByProvider: {},
          pendingForkSessionToken: null,
        })),
        forkChat: vi.fn(async () => ({ id: "" })),
        renameChat: vi.fn(async () => {}),
      },
    })
    await generateTitleInBackground(deps, "c1", "message content", "/path", "original")
    expect(deps.store.renameChat).toHaveBeenCalledWith("c1", "AI Title")
    expect(deps.emitStateChange).toHaveBeenCalledWith("c1")
  })

  it("skips rename when title has changed since the call was queued", async () => {
    const deps = makeDeps({
      generateTitle: vi.fn(async () => ({ title: "AI Title", usedFallback: false, failureMessage: null })),
      store: {
        getQueuedMessage: vi.fn(() => null),
        removeQueuedMessage: vi.fn(async () => {}),
        requireChat: vi.fn(() => ({
          title: "already changed",
          provider: null,
          sessionTokensByProvider: {},
          pendingForkSessionToken: null,
        })),
        forkChat: vi.fn(async () => ({ id: "" })),
        renameChat: vi.fn(async () => {}),
      },
    })
    await generateTitleInBackground(deps, "c1", "message content", "/path", "original")
    expect(deps.store.renameChat).not.toHaveBeenCalled()
  })

  it("skips rename when usedFallback is true", async () => {
    const deps = makeDeps({
      generateTitle: vi.fn(async () => ({ title: "fallback", usedFallback: true, failureMessage: null })),
    })
    await generateTitleInBackground(deps, "c1", "content", "/path", "original")
    expect(deps.store.renameChat).not.toHaveBeenCalled()
  })

  it("reports error on failure without throwing", async () => {
    const report = vi.fn((_msg: string) => {})
    const deps = makeDeps({
      generateTitle: vi.fn(async () => { throw new Error("API error") }),
      reportBackgroundError: report,
    })
    await expect(
      generateTitleInBackground(deps, "c1", "content", "/path", "original"),
    ).resolves.toBeUndefined()
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("[title-generation] chat c1 failed background title generation: API error"),
    )
  })

  it("reports provider failure message without renaming", async () => {
    const report = vi.fn((_msg: string) => {})
    const deps = makeDeps({
      generateTitle: vi.fn(async () => ({ title: "title", usedFallback: false, failureMessage: "quota exceeded" })),
      reportBackgroundError: report,
    })
    await generateTitleInBackground(deps, "c1", "content", "/path", "original")
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("failed provider title generation: quota exceeded"),
    )
  })
})
