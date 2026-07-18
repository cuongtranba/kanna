/**
 * Tests for the extracted chat management functions.
 * All deps are injected stubs — no IO, no Claude harness.
 */

import { describe, it, expect, mock } from "bun:test"
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

// ---------------------------------------------------------------------------
// Minimal stub helpers
// ---------------------------------------------------------------------------

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
      has: mock(() => false),
      get: mock(() => undefined),
    },
    drainingStreams: {
      get: mock(() => undefined),
      has: mock(() => false),
      delete: mock(() => false),
    },
    claudeSessions: {
      get: mock(() => undefined),
    },
    autoResumeByChat: {
      delete: mock(() => false),
    },
    store: {
      getQueuedMessage: mock((_chatId: string, _id: string) => null),
      removeQueuedMessage: mock(async () => {}),
      requireChat: mock((_chatId: string) => ({
        title: "Chat title",
        provider: "claude" as const,
        sessionTokensByProvider: { claude: "tok-123" },
        pendingForkSessionToken: null,
      })),
      forkChat: mock(async (_chatId: string) => ({ id: "forked-id" })),
      renameChat: mock(async () => {}),
    },
    analytics: {
      track: mock(() => {}),
    },
    cancel: mock(async () => {}),
    closeClaudeSession: mock(() => {}),
    emitStateChange: mock(() => {}),
    generateTitle: mock(async () => ({ title: "New Title", usedFallback: false, failureMessage: null })),
    reportBackgroundError: null,
    dequeueAndStartQueuedMessage: mock(async () => {}),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// stopDraining
// ---------------------------------------------------------------------------

describe("stopDraining", () => {
  it("is a no-op when no draining stream exists", async () => {
    const deps = makeDeps()
    await stopDraining(deps, "chat-1")
    expect(deps.emitStateChange).not.toHaveBeenCalled()
    expect(deps.drainingStreams.delete).not.toHaveBeenCalled()
  })

  it("closes the turn, removes the stream, and emits state change", async () => {
    const close = mock(() => {})
    const deps = makeDeps({
      drainingStreams: {
        get: mock(() => ({ turn: { close } })),
        has: mock(() => true),
        delete: mock(() => true),
      },
    })
    await stopDraining(deps, "chat-1")
    expect(close).toHaveBeenCalledTimes(1)
    expect(deps.drainingStreams.delete).toHaveBeenCalledWith("chat-1")
    expect(deps.emitStateChange).toHaveBeenCalledWith("chat-1")
  })
})

// ---------------------------------------------------------------------------
// closeChat
// ---------------------------------------------------------------------------

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
      claudeSessions: { get: mock(() => fakeSession) },
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

// ---------------------------------------------------------------------------
// steer
// ---------------------------------------------------------------------------

describe("steer", () => {
  it("throws when queued message not found", async () => {
    const deps = makeDeps()
    await expect(
      steer(deps, { type: "message.steer", chatId: "c1", queuedMessageId: "qm-1" }),
    ).rejects.toThrow("Queued message not found")
  })

  it("cancels active turn then dequeues when chat is active", async () => {
    const qm = makeQueuedMessage()
    // steer() calls has() 4 times: (1) in the log object, (2) the real guard that
    // triggers cancel, (3) in the after-cancel log, (4) the throw guard.
    // We need calls 1+2 → true (chat is active), calls 3+4 → false (idle after cancel).
    let hasCallCount = 0
    const cancelFn = mock(async () => {})
    const dequeueStartFn = mock(async () => {})
    const deps: ChatManagementDeps = {
      ...makeDeps(),
      activeTurns: {
        has: (_chatId: string) => hasCallCount++ < 2, // first 2 calls → active; rest → idle
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
    expect(cancelFn).toHaveBeenCalledWith("c1", { hideInterrupted: true, skipQueueDrain: true })
    expect(dequeueStartFn).toHaveBeenCalledWith("c1", qm, { steered: true })
  })

  it("throws when chat is still active after cancel", async () => {
    const qm = makeQueuedMessage()
    const deps: ChatManagementDeps = {
      ...makeDeps(),
      activeTurns: {
        has: () => true, // always active — cancel didn't help
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

// ---------------------------------------------------------------------------
// dequeue
// ---------------------------------------------------------------------------

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
        has: mock(() => true),
        get: mock(() => ({ proactiveCompactInjection: true })),
      },
      store: {
        getQueuedMessage: mock(() => qm),
        removeQueuedMessage: mock(async () => {}),
        requireChat: mock(() => ({ title: "", provider: null, sessionTokensByProvider: {}, pendingForkSessionToken: null })),
        forkChat: mock(async () => ({ id: "" })),
        renameChat: mock(async () => {}),
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
        getQueuedMessage: mock(() => qm),
        removeQueuedMessage: mock(async () => {}),
        requireChat: mock(() => ({ title: "", provider: null, sessionTokensByProvider: {}, pendingForkSessionToken: null })),
        forkChat: mock(async () => ({ id: "" })),
        renameChat: mock(async () => {}),
      },
    })
    await dequeue(deps, { type: "message.dequeue", chatId: "c1", queuedMessageId: "qm-1" })
    expect(deps.store.removeQueuedMessage).toHaveBeenCalledWith("c1", "qm-1")
  })
})

// ---------------------------------------------------------------------------
// forkChat
// ---------------------------------------------------------------------------

describe("forkChat", () => {
  it("throws when chat is active", async () => {
    const deps = makeDeps({
      activeTurns: { has: mock(() => true), get: mock(() => undefined) },
    })
    await expect(forkChat(deps, "c1")).rejects.toThrow("Chat must be idle before forking")
  })

  it("throws when chat is draining", async () => {
    const deps = makeDeps({
      drainingStreams: { has: mock(() => true), get: mock(() => undefined), delete: mock(() => false) },
    })
    await expect(forkChat(deps, "c1")).rejects.toThrow("Chat must be idle before forking")
  })

  it("throws when chat has no provider", async () => {
    const deps = makeDeps({
      store: {
        getQueuedMessage: mock(() => null),
        removeQueuedMessage: mock(async () => {}),
        requireChat: mock(() => ({ title: "", provider: null, sessionTokensByProvider: {}, pendingForkSessionToken: null })),
        forkChat: mock(async () => ({ id: "" })),
        renameChat: mock(async () => {}),
      },
    })
    await expect(forkChat(deps, "c1")).rejects.toThrow("Chat must have a provider before forking")
  })

  it("throws when chat has no session token", async () => {
    const deps = makeDeps({
      store: {
        getQueuedMessage: mock(() => null),
        removeQueuedMessage: mock(async () => {}),
        requireChat: mock(() => ({
          title: "",
          provider: "claude" as const,
          sessionTokensByProvider: { claude: null },
          pendingForkSessionToken: null,
        })),
        forkChat: mock(async () => ({ id: "" })),
        renameChat: mock(async () => {}),
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
        getQueuedMessage: mock(() => null),
        removeQueuedMessage: mock(async () => {}),
        requireChat: mock(() => ({
          title: "",
          provider: "claude" as const,
          sessionTokensByProvider: { claude: null },
          pendingForkSessionToken: { provider: "claude" as const, token: "pending-tok" },
        })),
        forkChat: mock(async () => ({ id: "forked-2" })),
        renameChat: mock(async () => {}),
      },
    })
    const result = await forkChat(deps, "c1")
    expect(result).toEqual({ chatId: "forked-2" })
  })
})

// ---------------------------------------------------------------------------
// generateTitleInBackground
// ---------------------------------------------------------------------------

describe("generateTitleInBackground", () => {
  it("renames chat when title generation succeeds and title still matches", async () => {
    const deps = makeDeps({
      generateTitle: mock(async () => ({ title: "AI Title", usedFallback: false, failureMessage: null })),
      store: {
        getQueuedMessage: mock(() => null),
        removeQueuedMessage: mock(async () => {}),
        requireChat: mock(() => ({
          title: "original",
          provider: null,
          sessionTokensByProvider: {},
          pendingForkSessionToken: null,
        })),
        forkChat: mock(async () => ({ id: "" })),
        renameChat: mock(async () => {}),
      },
    })
    await generateTitleInBackground(deps, "c1", "message content", "/path", "original")
    expect(deps.store.renameChat).toHaveBeenCalledWith("c1", "AI Title")
    expect(deps.emitStateChange).toHaveBeenCalledWith("c1")
  })

  it("skips rename when title has changed since the call was queued", async () => {
    const deps = makeDeps({
      generateTitle: mock(async () => ({ title: "AI Title", usedFallback: false, failureMessage: null })),
      store: {
        getQueuedMessage: mock(() => null),
        removeQueuedMessage: mock(async () => {}),
        requireChat: mock(() => ({
          title: "already changed",
          provider: null,
          sessionTokensByProvider: {},
          pendingForkSessionToken: null,
        })),
        forkChat: mock(async () => ({ id: "" })),
        renameChat: mock(async () => {}),
      },
    })
    await generateTitleInBackground(deps, "c1", "message content", "/path", "original")
    expect(deps.store.renameChat).not.toHaveBeenCalled()
  })

  it("skips rename when usedFallback is true", async () => {
    const deps = makeDeps({
      generateTitle: mock(async () => ({ title: "fallback", usedFallback: true, failureMessage: null })),
    })
    await generateTitleInBackground(deps, "c1", "content", "/path", "original")
    expect(deps.store.renameChat).not.toHaveBeenCalled()
  })

  it("reports error on failure without throwing", async () => {
    const report = mock((_msg: string) => {})
    const deps = makeDeps({
      generateTitle: mock(async () => { throw new Error("API error") }),
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
    const report = mock((_msg: string) => {})
    const deps = makeDeps({
      generateTitle: mock(async () => ({ title: "title", usedFallback: false, failureMessage: "quota exceeded" })),
      reportBackgroundError: report,
    })
    await generateTitleInBackground(deps, "c1", "content", "/path", "original")
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("failed provider title generation: quota exceeded"),
    )
  })
})
