import { describe, expect, test } from "bun:test"
import { STORE_VERSION } from "../shared/types"
import type { ToolRequest } from "../shared/permission-policy"
import { AUTO_CONTINUE_EVENT_VERSION } from "./auto-continue/events"
import type { AutoContinueEvent } from "./auto-continue/events"
import { createEmptyState } from "./events"
import type { TranscriptEntry } from "../shared/types"
import { applyStoreEvent } from "./event-store-apply"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TS = 1_700_000_000_000

function makeState() {
  return createEmptyState()
}

function makeBaseChat() {
  return {
    id: "chat-1",
    projectId: "proj-1",
    title: "C",
    createdAt: TS,
    updatedAt: TS,
    unread: false,
    provider: null as null,
    planMode: false,
    sessionTokensByProvider: {} as Record<string, string | null>,
    sourceHash: null as null,
    pendingForkSessionToken: null as null,
    hasMessages: false,
    lastTurnOutcome: null as null,
  }
}

function makeToolRequest(): ToolRequest {
  return {
    id: "req-1",
    chatId: "chat-1",
    sessionId: "sess-1",
    toolUseId: "tool-use-1",
    toolName: "AskUserQuestion",
    arguments: {},
    canonicalArgsHash: "hash",
    policyVerdict: "ask",
    status: "pending",
    createdAt: TS,
    expiresAt: TS + 600_000,
  }
}

// ---------------------------------------------------------------------------
// Project events
// ---------------------------------------------------------------------------

describe("applyStoreEvent — project events", () => {
  test("project_opened populates projectsById and projectIdsByPath", () => {
    const state = makeState()
    applyStoreEvent(
      {
        v: STORE_VERSION,
        type: "project_opened",
        timestamp: TS,
        projectId: "proj-1",
        localPath: "/tmp/repo",
        title: "Repo",
      },
      state,
      new Map(),
      new Map(),
    )
    expect(state.projectsById.has("proj-1")).toBe(true)
  })

  test("project_removed soft-deletes", () => {
    const state = makeState()
    state.projectsById.set("proj-1", {
      id: "proj-1", localPath: "/tmp/repo", title: "R", createdAt: TS, updatedAt: TS,
    })
    state.projectIdsByPath.set("/tmp/repo", "proj-1")
    applyStoreEvent(
      { v: STORE_VERSION, type: "project_removed", timestamp: TS + 1, projectId: "proj-1" },
      state,
      new Map(),
      new Map(),
    )
    expect(state.projectsById.get("proj-1")?.deletedAt).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Chat lifecycle events
// ---------------------------------------------------------------------------

describe("applyStoreEvent — chat events", () => {
  test("chat_created populates chatsById and chatTimingsByChatId", () => {
    const state = makeState()
    applyStoreEvent(
      {
        v: STORE_VERSION,
        type: "chat_created",
        timestamp: TS,
        chatId: "chat-1",
        projectId: "proj-1",
        title: "New Chat",
      },
      state,
      new Map(),
      new Map(),
    )
    expect(state.chatsById.has("chat-1")).toBe(true)
    expect(state.chatTimingsByChatId.has("chat-1")).toBe(true)
  })

  test("chat_renamed updates title", () => {
    const state = makeState()
    state.chatsById.set("chat-1", makeBaseChat())
    applyStoreEvent(
      { v: STORE_VERSION, type: "chat_renamed", timestamp: TS + 1, chatId: "chat-1", title: "New" },
      state,
      new Map(),
      new Map(),
    )
    expect(state.chatsById.get("chat-1")?.title).toBe("New")
  })

  test("chat_provider_set updates provider in chatsById and replayChatProvider", () => {
    const state = makeState()
    state.chatsById.set("chat-1", makeBaseChat())
    const replay = new Map<string, "claude" | null>([["chat-1", null]])
    applyStoreEvent(
      { v: STORE_VERSION, type: "chat_provider_set", timestamp: TS + 1, chatId: "chat-1", provider: "claude" },
      state,
      new Map(),
      replay,
    )
    expect(state.chatsById.get("chat-1")?.provider).toBe("claude")
    expect(replay.get("chat-1")).toBe("claude")
  })
})

// ---------------------------------------------------------------------------
// message_appended
// ---------------------------------------------------------------------------

describe("applyStoreEvent — message_appended", () => {
  test("appends to legacyMessagesByChatId and marks hasMessages", () => {
    const state = makeState()
    state.chatsById.set("chat-1", makeBaseChat())
    const legacy = new Map<string, TranscriptEntry[]>()
    applyStoreEvent(
      {
        v: STORE_VERSION,
        type: "message_appended",
        timestamp: TS,
        chatId: "chat-1",
        entry: { kind: "user_prompt", content: "hello", createdAt: TS, _id: "entry-1" } as TranscriptEntry,
      },
      state,
      legacy,
      new Map(),
    )
    expect(legacy.get("chat-1")?.length).toBe(1)
    expect(state.chatsById.get("chat-1")?.hasMessages).toBe(true)
  })

  test("multiple appends accumulate entries", () => {
    const state = makeState()
    state.chatsById.set("chat-1", makeBaseChat())
    const legacy = new Map<string, TranscriptEntry[]>()
    for (let i = 0; i < 3; i++) {
      applyStoreEvent(
        {
          v: STORE_VERSION,
          type: "message_appended",
          timestamp: TS + i,
          chatId: "chat-1",
          entry: {
            kind: "user_prompt",
            content: `msg-${i}`,
            createdAt: TS + i,
            _id: `entry-${i}`,
          } as TranscriptEntry,
        },
        state,
        legacy,
        new Map(),
      )
    }
    expect(legacy.get("chat-1")?.length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Stack events
// ---------------------------------------------------------------------------

describe("applyStoreEvent — stack events", () => {
  test("stack_added creates a stack", () => {
    const state = makeState()
    applyStoreEvent(
      {
        v: STORE_VERSION,
        type: "stack_added",
        timestamp: TS,
        stackId: "stack-1",
        title: "My Stack",
        projectIds: ["proj-1", "proj-2"],
      },
      state,
      new Map(),
      new Map(),
    )
    expect(state.stacksById.has("stack-1")).toBe(true)
    const stack = state.stacksById.get("stack-1")
    if (stack) {
      expect(stack.title).toBe("My Stack")
    }
  })

  test("stack_removed soft-deletes", () => {
    const state = makeState()
    state.stacksById.set("stack-1", {
      id: "stack-1", title: "S", projectIds: ["p1", "p2"], createdAt: TS, updatedAt: TS,
    })
    applyStoreEvent(
      { v: STORE_VERSION, type: "stack_removed", timestamp: TS + 1, stackId: "stack-1" },
      state,
      new Map(),
      new Map(),
    )
    expect(state.stacksById.get("stack-1")?.deletedAt).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Auto-continue events (kind-based dispatch)
// ---------------------------------------------------------------------------

describe("applyStoreEvent — auto-continue events", () => {
  test("auto_continue_accepted is routed to autoContinueEventsByChatId", () => {
    const state = makeState()
    const event: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      chatId: "chat-1",
      scheduleId: "sched-1",
      timestamp: TS,
      scheduledAt: TS,
      tz: "UTC",
      source: "subagent_background",
      resetAt: TS + 60_000,
      detectedAt: TS - 1_000,
      prompt: "do next thing",
    }
    applyStoreEvent(event, state, new Map(), new Map())
    expect(state.autoContinueEventsByChatId.has("chat-1")).toBe(true)
    expect(state.autoContinueEventsByChatId.get("chat-1")?.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Tool-request events
// ---------------------------------------------------------------------------

describe("applyStoreEvent — tool request events", () => {
  test("tool_request_put adds to toolRequestsById", () => {
    const state = makeState()
    const req = makeToolRequest()
    applyStoreEvent(
      { v: STORE_VERSION, type: "tool_request_put", timestamp: TS, request: req },
      state,
      new Map(),
      new Map(),
    )
    expect(state.toolRequestsById.has("req-1")).toBe(true)
  })
})
