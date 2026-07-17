import { describe, expect, test } from "bun:test"
import type { AgentProvider } from "../shared/types"
import type { ChatRecord, ChatTimingState, ProjectRecord, StackRecord, StoreState } from "./events"
import type { AutoContinueEvent } from "./auto-continue/events"
import {
  applyChatLifecycleEvent,
  applyChatMessageMetadata,
  applyAutoContinueToState,
  applyProjectEvent,
  applyStackEvent,
  updateChatTiming,
} from "./event-store-chat-lifecycle"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TS = 1_700_000_000_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProjectState(): Pick<StoreState, "projectsById" | "projectIdsByPath" | "sidebarProjectOrder"> {
  return {
    projectsById: new Map(),
    projectIdsByPath: new Map(),
    sidebarProjectOrder: [],
  }
}

function makeStacksById(): Map<string, StackRecord> {
  return new Map()
}

function makeTimings(): Map<string, ChatTimingState> {
  return new Map()
}

function makeChatLifecycleState(): Pick<
  StoreState,
  "chatsById" | "queuedMessagesByChatId" | "autoContinueEventsByChatId" | "chatTimingsByChatId" | "subagentRunsByChatId"
> {
  return {
    chatsById: new Map(),
    queuedMessagesByChatId: new Map(),
    autoContinueEventsByChatId: new Map(),
    chatTimingsByChatId: new Map(),
    subagentRunsByChatId: new Map(),
  }
}

function makeReplayChatProvider(): Map<string, AgentProvider | null> {
  return new Map()
}

// ---------------------------------------------------------------------------
// applyProjectEvent
// ---------------------------------------------------------------------------

describe("applyProjectEvent", () => {
  test("project_opened creates project and maps localPath", () => {
    const state = makeProjectState()
    applyProjectEvent(state, {
      v: 3,
      type: "project_opened",
      timestamp: TS,
      projectId: "proj-1",
      localPath: "/home/user/repo",
      title: "My Repo",
    })
    const project = state.projectsById.get("proj-1")
    expect(project).toBeDefined()
    expect(project!.title).toBe("My Repo")
    expect(state.projectIdsByPath.get(project!.localPath)).toBe("proj-1")
  })

  test("project_removed soft-deletes and removes path index", () => {
    const state = makeProjectState()
    const project: ProjectRecord = { id: "proj-1", localPath: "/tmp/repo", title: "R", createdAt: TS, updatedAt: TS }
    state.projectsById.set("proj-1", project)
    state.projectIdsByPath.set("/tmp/repo", "proj-1")

    applyProjectEvent(state, { v: 3, type: "project_removed", timestamp: TS + 1, projectId: "proj-1" })

    expect(project.deletedAt).toBe(TS + 1)
    expect(state.projectIdsByPath.has("/tmp/repo")).toBe(false)
  })

  test("project_removed is a no-op for unknown project", () => {
    const state = makeProjectState()
    // Should not throw
    applyProjectEvent(state, { v: 3, type: "project_removed", timestamp: TS, projectId: "nope" })
    expect(state.projectsById.size).toBe(0)
  })

  test("sidebar_project_order_set replaces sidebarProjectOrder", () => {
    const state = makeProjectState()
    state.sidebarProjectOrder = ["old-1"]
    applyProjectEvent(state, { v: 3, type: "sidebar_project_order_set", timestamp: TS, projectIds: ["p1", "p2"] })
    expect(state.sidebarProjectOrder).toEqual(["p1", "p2"])
  })

  test("project_star_set sets and clears starredAt", () => {
    const state = makeProjectState()
    const project: ProjectRecord = { id: "proj-1", localPath: "/tmp", title: "R", createdAt: TS, updatedAt: TS }
    state.projectsById.set("proj-1", project)

    applyProjectEvent(state, { v: 3, type: "project_star_set", timestamp: TS + 1, projectId: "proj-1", starredAt: TS + 1 })
    expect(project.starredAt).toBe(TS + 1)

    applyProjectEvent(state, { v: 3, type: "project_star_set", timestamp: TS + 2, projectId: "proj-1", starredAt: null })
    expect(project.starredAt).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// applyStackEvent
// ---------------------------------------------------------------------------

describe("applyStackEvent", () => {
  test("stack_added creates stack", () => {
    const m = makeStacksById()
    applyStackEvent(m, { v: 3, type: "stack_added", timestamp: TS, stackId: "s1", title: "S", projectIds: ["p1", "p2"] })
    const s = m.get("s1")
    expect(s).toBeDefined()
    expect(s!.projectIds).toEqual(["p1", "p2"])
  })

  test("stack_removed soft-deletes", () => {
    const m = makeStacksById()
    const s: StackRecord = { id: "s1", title: "S", projectIds: ["p1"], createdAt: TS, updatedAt: TS }
    m.set("s1", s)
    applyStackEvent(m, { v: 3, type: "stack_removed", timestamp: TS + 1, stackId: "s1" })
    expect(s.deletedAt).toBe(TS + 1)
  })

  test("stack_project_added appends without duplicates", () => {
    const m = makeStacksById()
    const s: StackRecord = { id: "s1", title: "S", projectIds: ["p1"], createdAt: TS, updatedAt: TS }
    m.set("s1", s)
    applyStackEvent(m, { v: 3, type: "stack_project_added", timestamp: TS + 1, stackId: "s1", projectId: "p2" })
    applyStackEvent(m, { v: 3, type: "stack_project_added", timestamp: TS + 2, stackId: "s1", projectId: "p2" })
    expect(s.projectIds).toEqual(["p1", "p2"])
  })

  test("stack_project_removed removes project", () => {
    const m = makeStacksById()
    const s: StackRecord = { id: "s1", title: "S", projectIds: ["p1", "p2"], createdAt: TS, updatedAt: TS }
    m.set("s1", s)
    applyStackEvent(m, { v: 3, type: "stack_project_removed", timestamp: TS + 1, stackId: "s1", projectId: "p1" })
    expect(s.projectIds).toEqual(["p2"])
  })

  test("stack_renamed updates title", () => {
    const m = makeStacksById()
    const s: StackRecord = { id: "s1", title: "Old", projectIds: [], createdAt: TS, updatedAt: TS }
    m.set("s1", s)
    applyStackEvent(m, { v: 3, type: "stack_renamed", timestamp: TS + 1, stackId: "s1", title: "New" })
    expect(s.title).toBe("New")
  })

  test("ops on deleted stack are ignored", () => {
    const m = makeStacksById()
    const s: StackRecord = { id: "s1", title: "S", projectIds: ["p1"], createdAt: TS, updatedAt: TS, deletedAt: TS }
    m.set("s1", s)
    applyStackEvent(m, { v: 3, type: "stack_project_added", timestamp: TS + 1, stackId: "s1", projectId: "p2" })
    expect(s.projectIds).toEqual(["p1"]) // no change
  })
})

// ---------------------------------------------------------------------------
// updateChatTiming
// ---------------------------------------------------------------------------

describe("updateChatTiming", () => {
  test("seeds initial timing on first call (chat_created path)", () => {
    const m = makeTimings()
    updateChatTiming(m, "chat-1", TS, "idle")
    const t = m.get("chat-1")!
    expect(t.status).toBe("idle")
    expect(t.activeSessionStartedAt).toBe(TS)
    expect(t.cumulativeMs).toEqual({ idle: 0, starting: 0, running: 0, failed: 0 })
  })

  test("accumulates segment time on transition", () => {
    const m = makeTimings()
    updateChatTiming(m, "chat-1", TS, "idle")
    updateChatTiming(m, "chat-1", TS + 1000, "running", true)
    const t = m.get("chat-1")!
    expect(t.cumulativeMs.idle).toBe(1000)
    expect(t.status).toBe("running")
    expect(t.lastTurnStartedAt).toBe(TS + 1000)
  })

  test("records lastTurnDurationMs on turn finish", () => {
    const m = makeTimings()
    updateChatTiming(m, "chat-1", TS, "idle")
    updateChatTiming(m, "chat-1", TS + 500, "running", true)
    updateChatTiming(m, "chat-1", TS + 2500, "idle", false, true)
    const t = m.get("chat-1")!
    expect(t.lastTurnDurationMs).toBe(2000)
  })
})

// ---------------------------------------------------------------------------
// applyChatLifecycleEvent
// ---------------------------------------------------------------------------

describe("applyChatLifecycleEvent — chat events", () => {
  test("chat_created sets initial fields and seeds maps", () => {
    const state = makeChatLifecycleState()
    const replay = makeReplayChatProvider()
    applyChatLifecycleEvent(state, replay, {
      v: 3, type: "chat_created", timestamp: TS, chatId: "c1", projectId: "p1", title: "Chat",
    })
    const chat = state.chatsById.get("c1")!
    expect(chat.projectId).toBe("p1")
    expect(chat.unread).toBe(false)
    expect(chat.provider).toBeNull()
    expect(chat.lastTurnOutcome).toBeNull()
    expect(replay.get("c1")).toBeNull()
    expect(state.subagentRunsByChatId.has("c1")).toBe(true)
    expect(state.chatTimingsByChatId.has("c1")).toBe(true)
  })

  test("chat_deleted soft-deletes and cleans sub-maps", () => {
    const state = makeChatLifecycleState()
    const replay = makeReplayChatProvider()
    applyChatLifecycleEvent(state, replay, { v: 3, type: "chat_created", timestamp: TS, chatId: "c1", projectId: "p1", title: "C" })
    applyChatLifecycleEvent(state, replay, { v: 3, type: "chat_deleted", timestamp: TS + 1, chatId: "c1" })
    expect(state.chatsById.get("c1")!.deletedAt).toBe(TS + 1)
    expect(state.queuedMessagesByChatId.has("c1")).toBe(false)
    expect(state.chatTimingsByChatId.has("c1")).toBe(false)
  })

  test("chat_provider_set updates provider and replay map", () => {
    const state = makeChatLifecycleState()
    const replay = makeReplayChatProvider()
    applyChatLifecycleEvent(state, replay, { v: 3, type: "chat_created", timestamp: TS, chatId: "c1", projectId: "p1", title: "C" })
    applyChatLifecycleEvent(state, replay, { v: 3, type: "chat_provider_set", timestamp: TS + 1, chatId: "c1", provider: "claude" })
    expect(state.chatsById.get("c1")!.provider).toBe("claude")
    expect(replay.get("c1")).toBe("claude")
  })

  test("session_token_set uses explicit provider", () => {
    const state = makeChatLifecycleState()
    const replay = makeReplayChatProvider()
    applyChatLifecycleEvent(state, replay, { v: 3, type: "chat_created", timestamp: TS, chatId: "c1", projectId: "p1", title: "C" })
    applyChatLifecycleEvent(state, replay, {
      v: 3, type: "session_token_set", timestamp: TS + 1, chatId: "c1", sessionToken: "tok", provider: "claude",
    })
    expect(state.chatsById.get("c1")!.sessionTokensByProvider.claude).toBe("tok")
  })

  test("session_token_set falls back to replayChatProvider", () => {
    const state = makeChatLifecycleState()
    const replay = makeReplayChatProvider()
    applyChatLifecycleEvent(state, replay, { v: 3, type: "chat_created", timestamp: TS, chatId: "c1", projectId: "p1", title: "C" })
    replay.set("c1", "codex")
    applyChatLifecycleEvent(state, replay, {
      v: 3, type: "session_token_set", timestamp: TS + 1, chatId: "c1", sessionToken: "tok2",
    })
    expect(state.chatsById.get("c1")!.sessionTokensByProvider.codex).toBe("tok2")
  })
})

describe("applyChatLifecycleEvent — turn events", () => {
  test("turn_started transitions timing to running and updates chat", () => {
    const state = makeChatLifecycleState()
    const replay = makeReplayChatProvider()
    applyChatLifecycleEvent(state, replay, { v: 3, type: "chat_created", timestamp: TS, chatId: "c1", projectId: "p1", title: "C" })
    applyChatLifecycleEvent(state, replay, { v: 3, type: "turn_started", timestamp: TS + 100, chatId: "c1" })
    expect(state.chatsById.get("c1")!.updatedAt).toBe(TS + 100)
    expect(state.chatTimingsByChatId.get("c1")!.status).toBe("running")
  })

  test("turn_finished sets unread and lastTurnOutcome", () => {
    const state = makeChatLifecycleState()
    const replay = makeReplayChatProvider()
    applyChatLifecycleEvent(state, replay, { v: 3, type: "chat_created", timestamp: TS, chatId: "c1", projectId: "p1", title: "C" })
    applyChatLifecycleEvent(state, replay, { v: 3, type: "turn_started", timestamp: TS + 100, chatId: "c1" })
    applyChatLifecycleEvent(state, replay, { v: 3, type: "turn_finished", timestamp: TS + 200, chatId: "c1" })
    const chat = state.chatsById.get("c1")!
    expect(chat.unread).toBe(true)
    expect(chat.lastTurnOutcome).toBe("success")
    expect(state.chatTimingsByChatId.get("c1")!.status).toBe("idle")
  })

  test("turn_failed sets failed outcome and timing", () => {
    const state = makeChatLifecycleState()
    const replay = makeReplayChatProvider()
    applyChatLifecycleEvent(state, replay, { v: 3, type: "chat_created", timestamp: TS, chatId: "c1", projectId: "p1", title: "C" })
    applyChatLifecycleEvent(state, replay, { v: 3, type: "turn_failed", timestamp: TS + 200, chatId: "c1", error: "oops" })
    expect(state.chatsById.get("c1")!.lastTurnOutcome).toBe("failed")
    expect(state.chatTimingsByChatId.get("c1")!.status).toBe("failed")
  })
})

describe("applyChatLifecycleEvent — queued message events", () => {
  test("queued_message_enqueued appends and updates chat", () => {
    const state = makeChatLifecycleState()
    const replay = makeReplayChatProvider()
    applyChatLifecycleEvent(state, replay, { v: 3, type: "chat_created", timestamp: TS, chatId: "c1", projectId: "p1", title: "C" })
    applyChatLifecycleEvent(state, replay, {
      v: 3,
      type: "queued_message_enqueued",
      timestamp: TS + 10,
      chatId: "c1",
      message: { id: "qm1", createdAt: TS + 10, kind: "user", text: "hello", attachments: [] },
    })
    const queued = state.queuedMessagesByChatId.get("c1")
    expect(queued?.length).toBe(1)
    expect(queued![0].id).toBe("qm1")
  })

  test("queued_message_removed removes message and deletes key when empty", () => {
    const state = makeChatLifecycleState()
    const replay = makeReplayChatProvider()
    applyChatLifecycleEvent(state, replay, { v: 3, type: "chat_created", timestamp: TS, chatId: "c1", projectId: "p1", title: "C" })
    applyChatLifecycleEvent(state, replay, {
      v: 3,
      type: "queued_message_enqueued",
      timestamp: TS + 10,
      chatId: "c1",
      message: { id: "qm1", createdAt: TS + 10, kind: "user", text: "hello", attachments: [] },
    })
    applyChatLifecycleEvent(state, replay, {
      v: 3, type: "queued_message_removed", timestamp: TS + 20, chatId: "c1", queuedMessageId: "qm1",
    })
    expect(state.queuedMessagesByChatId.has("c1")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// applyAutoContinueToState
// ---------------------------------------------------------------------------

describe("applyAutoContinueToState", () => {
  test("appends event to list", () => {
    const m = new Map<string, AutoContinueEvent[]>()
    const ev: AutoContinueEvent = {
      kind: "auto_continue_accepted",
      chatId: "c1",
      timestamp: TS,
      source: "turn_finished",
      prompt: "continue",
      subagentId: null,
    }
    applyAutoContinueToState(m, ev)
    applyAutoContinueToState(m, { ...ev, timestamp: TS + 1 })
    expect(m.get("c1")?.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// applyChatMessageMetadata
// ---------------------------------------------------------------------------

describe("applyChatMessageMetadata", () => {
  test("sets hasMessages and lastMessageAt for user_prompt", () => {
    const chatsById = new Map<string, ChatRecord>()
    chatsById.set("c1", {
      id: "c1", projectId: "p1", title: "C", createdAt: TS, updatedAt: TS,
      unread: false, provider: null, planMode: false,
      sessionTokensByProvider: {}, sourceHash: null, pendingForkSessionToken: null,
      hasMessages: false, lastTurnOutcome: null,
    })
    applyChatMessageMetadata(chatsById, "c1", {
      _id: "msg-1", kind: "user_prompt", createdAt: TS + 500,
      text: "hi", attachments: [],
    })
    const chat = chatsById.get("c1")!
    expect(chat.hasMessages).toBe(true)
    expect(chat.lastMessageAt).toBe(TS + 500)
    expect(chat.updatedAt).toBe(TS + 500)
  })

  test("does not set lastMessageAt for non-user_prompt entries", () => {
    const chatsById = new Map<string, ChatRecord>()
    chatsById.set("c1", {
      id: "c1", projectId: "p1", title: "C", createdAt: TS, updatedAt: TS,
      unread: false, provider: null, planMode: false,
      sessionTokensByProvider: {}, sourceHash: null, pendingForkSessionToken: null,
      hasMessages: false, lastTurnOutcome: null,
    })
    applyChatMessageMetadata(chatsById, "c1", {
      _id: "msg-2", kind: "context_cleared", createdAt: TS + 100,
    })
    const chat = chatsById.get("c1")!
    expect(chat.hasMessages).toBe(true)
    expect(chat.lastMessageAt).toBeUndefined()
  })

  test("is a no-op for unknown chatId", () => {
    const chatsById = new Map<string, ChatRecord>()
    // should not throw
    applyChatMessageMetadata(chatsById, "ghost", {
      _id: "msg-3", kind: "user_prompt", createdAt: TS, text: "hi", attachments: [],
    })
    expect(chatsById.size).toBe(0)
  })
})
