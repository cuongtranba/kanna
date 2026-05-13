import { describe, expect, test } from "bun:test"
import { canForkChat, deriveChatSnapshot, deriveLocalProjectsSnapshot, deriveSidebarData, deriveTimings, stackSummaries } from "./read-models"
import type { ChatRecord } from "./events"
import { createEmptyState } from "./events"
import type { AgentProvider, SlashCommand } from "../shared/types"

describe("read models", () => {
  test("include provider data in sidebar rows", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Project",
      createdAt: 1,
      updatedAt: 1,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")
    state.chatsById.set("chat-1", {
      id: "chat-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 1,
      updatedAt: 1,
      unread: true,
      provider: "codex",
      planMode: false,
      sessionTokensByProvider: { codex: "thread-1" },
      sourceHash: null,
      lastTurnOutcome: null,
    })

    const sidebar = deriveSidebarData(state, new Map(), { nowMs: 1_000_000 })
    expect(sidebar.projectGroups[0]?.chats[0]?.provider).toBe("codex")
    expect(sidebar.projectGroups[0]?.chats[0]?.unread).toBe(true)
    expect(sidebar.projectGroups[0]?.chats[0]?.canFork).toBe(true)
    expect(sidebar.projectGroups[0]?.previewChats.map((chat) => chat.chatId)).toEqual(["chat-1"])
    expect(sidebar.projectGroups[0]?.olderChats).toEqual([])
    expect(sidebar.projectGroups[0]?.defaultCollapsed).toBe(false)
  })

  test("keeps archived chats out of the main sidebar rows", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Project",
      createdAt: 1,
      updatedAt: 1,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")
    state.chatsById.set("chat-active", {
      id: "chat-active",
      projectId: "project-1",
      title: "Active",
      createdAt: 1,
      updatedAt: 1,
      unread: false,
      provider: null,
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      lastTurnOutcome: null,
    })
    state.chatsById.set("chat-archived", {
      id: "chat-archived",
      projectId: "project-1",
      title: "Archived",
      createdAt: 2,
      updatedAt: 3,
      archivedAt: 3,
      unread: false,
      provider: null,
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      lastTurnOutcome: null,
    })

    const sidebar = deriveSidebarData(state, new Map(), { nowMs: 1_000_000 })

    expect(sidebar.projectGroups[0]?.chats.map((chat) => chat.chatId)).toEqual(["chat-active"])
    expect(sidebar.projectGroups[0]?.archivedChats?.map((chat) => chat.chatId)).toEqual(["chat-archived"])
  })

  test("includes available providers in chat snapshots", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Project",
      createdAt: 1,
      updatedAt: 1,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")
    state.chatsById.set("chat-1", {
      id: "chat-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 1,
      updatedAt: 1,
      unread: false,
      provider: "claude",
      planMode: true,
      sessionTokensByProvider: { claude: "session-1" },
      sourceHash: null,
      lastTurnOutcome: null,
    })
    state.queuedMessagesByChatId.set("chat-1", [{
      id: "queued-1",
      content: "follow up",
      attachments: [],
      createdAt: 2,
      provider: "claude",
      model: "claude-sonnet-4-6",
      planMode: true,
    }])

    const chat = deriveChatSnapshot(
      state,
      new Map(),
      new Set(),
      new Set(),
      "chat-1",
      () => ({
        messages: [],
        history: {
          hasOlder: false,
          olderCursor: null,
          recentLimit: 200,
        },
      }),
      () => []
    )
    expect(chat?.runtime.provider).toBe("claude")
    expect(chat?.queuedMessages.map((message) => message.content)).toEqual(["follow up"])
    expect(chat?.history.recentLimit).toBe(200)
    expect(chat?.availableProviders.length).toBeGreaterThan(1)
    expect(chat?.availableProviders.find((provider) => provider.id === "codex")?.models.map((model) => model.id)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
    ])
  })

  test("prefers saved project metadata over discovered entries for the same path", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Saved Project",
      createdAt: 1,
      updatedAt: 50,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")
    state.chatsById.set("chat-1", {
      id: "chat-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 1,
      updatedAt: 75,
      unread: false,
      provider: "codex",
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      lastMessageAt: 100,
      lastTurnOutcome: null,
    })

    const snapshot = deriveLocalProjectsSnapshot(state, [
      {
        localPath: "/tmp/project",
        title: "Discovered Project",
        modifiedAt: 10,
      },
    ], "Local Machine")

    expect(snapshot.projects).toEqual([
      {
        localPath: "/tmp/project",
        title: "Saved Project",
        source: "saved",
        lastOpenedAt: 100,
        chatCount: 1,
      },
    ])
  })

  test("orders sidebar chats by user-visible activity instead of internal updatedAt churn", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Project",
      createdAt: 1,
      updatedAt: 1,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")
    state.chatsById.set("chat-old", {
      id: "chat-old",
      projectId: "project-1",
      title: "Older user activity",
      createdAt: 10,
      updatedAt: 500,
      unread: false,
      provider: "claude",
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      lastMessageAt: 100,
      lastTurnOutcome: null,
    })
    state.chatsById.set("chat-new", {
      id: "chat-new",
      projectId: "project-1",
      title: "Newer user activity",
      createdAt: 20,
      updatedAt: 50,
      unread: false,
      provider: "claude",
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      lastMessageAt: 200,
      lastTurnOutcome: null,
    })

    const sidebar = deriveSidebarData(state, new Map())
    expect(sidebar.projectGroups[0]?.chats.map((chat) => chat.chatId)).toEqual(["chat-new", "chat-old"])
  })

  test("honors persisted project order before fallback updated-at ordering", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project-1",
      title: "One",
      createdAt: 1,
      updatedAt: 10,
    })
    state.projectsById.set("project-2", {
      id: "project-2",
      localPath: "/tmp/project-2",
      title: "Two",
      createdAt: 2,
      updatedAt: 20,
    })
    state.projectsById.set("project-3", {
      id: "project-3",
      localPath: "/tmp/project-3",
      title: "Three",
      createdAt: 3,
      updatedAt: 15,
    })
    const sidebar = deriveSidebarData(state, new Map(), { sidebarProjectOrder: ["project-1"] })

    expect(sidebar.projectGroups.map((group) => group.groupKey)).toEqual(["project-1", "project-2", "project-3"])
  })

  test("builds preview and older chat slices using the current sidebar rules", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Project",
      createdAt: 1,
      updatedAt: 1,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")
    state.chatsById.set("chat-1", {
      id: "chat-1",
      projectId: "project-1",
      title: "Recent",
      createdAt: 10,
      updatedAt: 10,
      unread: false,
      provider: "claude",
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      lastMessageAt: 1_000_000 - 60 * 60 * 1_000,
      lastTurnOutcome: null,
    })
    state.chatsById.set("chat-2", {
      id: "chat-2",
      projectId: "project-1",
      title: "Older",
      createdAt: 20,
      updatedAt: 20,
      unread: false,
      provider: "claude",
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      lastMessageAt: 1_000_000 - 26 * 60 * 60 * 1_000,
      lastTurnOutcome: null,
    })

    const sidebar = deriveSidebarData(state, new Map(), { nowMs: 1_000_000 })

    expect(sidebar.projectGroups[0]?.previewChats.map((chat) => chat.chatId)).toEqual(["chat-1"])
    expect(sidebar.projectGroups[0]?.olderChats.map((chat) => chat.chatId)).toEqual(["chat-2"])
    expect(sidebar.projectGroups[0]?.defaultCollapsed).toBe(false)
  })

  test("shows all recent chats in the preview before folding older chats", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Project",
      createdAt: 1,
      updatedAt: 1,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")

    for (let index = 0; index < 6; index++) {
      const chatNumber = index + 1
      state.chatsById.set(`chat-${chatNumber}`, {
        id: `chat-${chatNumber}`,
        projectId: "project-1",
        title: `Chat ${chatNumber}`,
        createdAt: chatNumber,
        updatedAt: chatNumber,
        unread: false,
        provider: "claude",
        planMode: false,
        sessionTokensByProvider: {},
        sourceHash: null,
        lastMessageAt: 1_000_000 - chatNumber * 60 * 1_000,
        lastTurnOutcome: null,
      })
    }

    const sidebar = deriveSidebarData(state, new Map(), { nowMs: 1_000_000 })

    expect(sidebar.projectGroups[0]?.previewChats.map((chat) => chat.chatId)).toEqual([
      "chat-1",
      "chat-2",
      "chat-3",
      "chat-4",
      "chat-5",
      "chat-6",
    ])
    expect(sidebar.projectGroups[0]?.olderChats.map((chat) => chat.chatId)).toEqual([])
  })

  test("disables forking for active and draining chats, but allows pending fork chats", () => {
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Project",
      createdAt: 1,
      updatedAt: 1,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")
    state.chatsById.set("chat-active", {
      id: "chat-active",
      projectId: "project-1",
      title: "Active",
      createdAt: 1,
      updatedAt: 1,
      unread: false,
      provider: "claude",
      planMode: false,
      sessionTokensByProvider: { claude: "session-active" },
      sourceHash: null,
      lastTurnOutcome: null,
    })
    state.chatsById.set("chat-pending", {
      id: "chat-pending",
      projectId: "project-1",
      title: "Pending fork",
      createdAt: 2,
      updatedAt: 2,
      unread: false,
      provider: "claude",
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      pendingForkSessionToken: { provider: "claude", token: "session-parent" },
      lastTurnOutcome: null,
    })
    state.chatsById.set("chat-draining", {
      id: "chat-draining",
      projectId: "project-1",
      title: "Draining",
      createdAt: 3,
      updatedAt: 3,
      unread: false,
      provider: "codex",
      planMode: false,
      sessionTokensByProvider: { codex: "thread-1" },
      sourceHash: null,
      lastTurnOutcome: null,
    })

    const sidebar = deriveSidebarData(
      state,
      new Map([["chat-active", "running"]]),
      { drainingChatIds: new Set(["chat-draining"]) }
    )

    expect(sidebar.projectGroups[0]?.chats.find((chat) => chat.chatId === "chat-active")?.canFork).toBeUndefined()
    expect(sidebar.projectGroups[0]?.chats.find((chat) => chat.chatId === "chat-pending")?.canFork).toBe(true)
    expect(sidebar.projectGroups[0]?.chats.find((chat) => chat.chatId === "chat-draining")?.canFork).toBeUndefined()
  })

  test("partitions starred projects into starredProjectGroups sorted by starredAt desc, unstarred into projectGroups", () => {
    const state = createEmptyState()
    state.projectsById.set("p1", {
      id: "p1",
      localPath: "/tmp/p1",
      title: "P1",
      createdAt: 1,
      updatedAt: 1,
      starredAt: 1000,
    })
    state.projectsById.set("p2", {
      id: "p2",
      localPath: "/tmp/p2",
      title: "P2",
      createdAt: 2,
      updatedAt: 2,
    })
    state.projectsById.set("p3", {
      id: "p3",
      localPath: "/tmp/p3",
      title: "P3",
      createdAt: 3,
      updatedAt: 3,
      starredAt: 2000,
    })

    const sidebar = deriveSidebarData(state, new Map())
    expect(sidebar.starredProjectGroups.map((g) => g.groupKey)).toEqual(["p3", "p1"])
    expect(sidebar.projectGroups.map((g) => g.groupKey)).toEqual(["p2"])
  })

  test("breaks starredProjectGroups ties by groupKey ascending", () => {
    const state = createEmptyState()
    state.projectsById.set("p2", {
      id: "p2",
      localPath: "/tmp/p2",
      title: "P2",
      createdAt: 2,
      updatedAt: 2,
      starredAt: 1000,
    })
    state.projectsById.set("p1", {
      id: "p1",
      localPath: "/tmp/p1",
      title: "P1",
      createdAt: 1,
      updatedAt: 1,
      starredAt: 1000,
    })

    const sidebar = deriveSidebarData(state, new Map())
    expect(sidebar.starredProjectGroups.map((g) => g.groupKey)).toEqual(["p1", "p2"])
  })

  test("returns empty starredProjectGroups when no projects are starred", () => {
    const state = createEmptyState()
    state.projectsById.set("p1", {
      id: "p1",
      localPath: "/tmp/p1",
      title: "P1",
      createdAt: 1,
      updatedAt: 1,
    })
    state.projectsById.set("p2", {
      id: "p2",
      localPath: "/tmp/p2",
      title: "P2",
      createdAt: 2,
      updatedAt: 2,
    })

    const sidebar = deriveSidebarData(state, new Map())
    expect(sidebar.starredProjectGroups).toEqual([])
    expect(sidebar.projectGroups.map((g) => g.groupKey)).toContain("p1")
    expect(sidebar.projectGroups.map((g) => g.groupKey)).toContain("p2")
  })

  test("deriveSidebarData includes stack summaries", () => {
    const state = createEmptyState()
    state.stacksById.set("s1", {
      id: "s1",
      title: "Integration",
      projectIds: ["p1", "p2"],
      createdAt: 1,
      updatedAt: 1,
    })
    const sidebar = deriveSidebarData(state, new Map())
    expect(sidebar.stacks).toHaveLength(1)
    expect(sidebar.stacks[0]?.title).toBe("Integration")
  })

  test("passes slash commands from ChatRecord through to ChatSnapshot", () => {
    const slashCommands: SlashCommand[] = [
      { name: "review", description: "r", argumentHint: "<pr>" },
    ]
    const state = createEmptyState()
    state.projectsById.set("project-1", {
      id: "project-1",
      localPath: "/tmp/project",
      title: "Project",
      createdAt: 1,
      updatedAt: 1,
    })
    state.projectIdsByPath.set("/tmp/project", "project-1")
    state.chatsById.set("chat-1", {
      id: "chat-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 1,
      updatedAt: 1,
      unread: false,
      provider: "claude",
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      lastTurnOutcome: null,
      slashCommands,
    })

    const snapshot = deriveChatSnapshot(
      state,
      new Map(),
      new Set(),
      new Set(),
      "chat-1",
      () => ({
        messages: [],
        history: {
          hasOlder: false,
          olderCursor: null,
          recentLimit: 200,
        },
      }),
      () => []
    )

    expect(snapshot?.slashCommands).toEqual(slashCommands)
  })
})

describe("deriveChatSnapshot schedules", () => {
  test("empty schedules produces empty map and null live id", () => {
    const state = createEmptyState()
    state.projectsById.set("p1", {
      id: "p1", localPath: "/tmp/p", title: "P", createdAt: 0, updatedAt: 0,
    })
    state.chatsById.set("c1", {
      id: "c1", projectId: "p1", title: "Chat", createdAt: 0, updatedAt: 0,
      unread: false, provider: null, planMode: false, sessionTokensByProvider: {}, sourceHash: null, lastTurnOutcome: null,
    })

    const snapshot = deriveChatSnapshot(
      state,
      new Map(),
      new Set(),
      new Set(),
      "c1",
      () => ({ messages: [], history: { hasOlder: false, olderCursor: null, recentLimit: 0 } }),
      () => []
    )
    expect(snapshot!.schedules).toEqual({})
    expect(snapshot!.liveScheduleId).toBeNull()
  })

  test("proposed event projects to schedules + liveScheduleId", () => {
    const state = createEmptyState()
    state.projectsById.set("p1", {
      id: "p1", localPath: "/tmp/p", title: "P", createdAt: 0, updatedAt: 0,
    })
    state.chatsById.set("c1", {
      id: "c1", projectId: "p1", title: "Chat", createdAt: 0, updatedAt: 0,
      unread: false, provider: null, planMode: false, sessionTokensByProvider: {}, sourceHash: null, lastTurnOutcome: null,
    })
    state.autoContinueEventsByChatId.set("c1", [{
      v: 3, kind: "auto_continue_proposed", timestamp: 1, chatId: "c1", scheduleId: "s1",
      detectedAt: 1, resetAt: 2_000, tz: "Asia/Saigon",
    }])

    const snapshot = deriveChatSnapshot(
      state,
      new Map(),
      new Set(),
      new Set(),
      "c1",
      () => ({ messages: [], history: { hasOlder: false, olderCursor: null, recentLimit: 0 } }),
      () => []
    )
    expect(snapshot!.schedules["s1"].state).toBe("proposed")
    expect(snapshot!.liveScheduleId).toBe("s1")
  })
})

describe("deriveTimings", () => {
  const baseTiming = {
    status: "idle" as const,
    stateEnteredAt: 1000,
    activeSessionStartedAt: 500,
    lastTurnStartedAt: null,
    lastTurnDurationMs: null,
    cumulativeMs: { idle: 500, starting: 0, running: 0, failed: 0 },
  }

  test("formats accumulator + nowMs into ChatStateTimings", () => {
    const out = deriveTimings(
      { createdAt: 500 } as any,
      { ...baseTiming },
      undefined, // no in-memory wait
      undefined,
      3000,
    )
    expect(out.activeSessionStartedAt).toBe(500)
    expect(out.chatCreatedAt).toBe(500)
    expect(out.stateEnteredAt).toBe(1000)
    expect(out.derivedAtMs).toBe(3000)
    expect(out.cumulativeMs.idle).toBe(500 + 2000) // 500 from accumulator + 2000 open segment to nowMs
    expect(out.cumulativeMs.waiting_for_user).toBe(0)
  })

  test("waitStartedAt overrides current state to waiting_for_user and adds open segment", () => {
    const out = deriveTimings(
      { createdAt: 500 } as any,
      { ...baseTiming, status: "running", stateEnteredAt: 1500, lastTurnStartedAt: 1500 },
      "waiting_for_user",
      2500,
      3000,
    )
    expect(out.cumulativeMs.waiting_for_user).toBe(500) // 3000 - 2500
    expect(out.stateEnteredAt).toBe(2500)
  })

  test("missing accumulator (legacy chat) falls back to chat.createdAt for everything", () => {
    const out = deriveTimings(
      { createdAt: 1000 } as any,
      undefined,
      undefined,
      undefined,
      4000,
    )
    expect(out.activeSessionStartedAt).toBe(1000)
    expect(out.chatCreatedAt).toBe(1000)
    expect(out.stateEnteredAt).toBe(1000)
    expect(out.cumulativeMs.idle).toBe(3000)
    expect(out.lastTurnDurationMs).toBeNull()
  })
})

describe("stackSummaries", () => {
  test("returns active stacks with member counts in insertion order", () => {
    const state = createEmptyState()
    state.stacksById.set("s1", {
      id: "s1",
      title: "A",
      projectIds: ["p1", "p2"],
      createdAt: 1,
      updatedAt: 1,
    })
    state.stacksById.set("s2", {
      id: "s2",
      title: "B",
      projectIds: ["p2", "p3"],
      createdAt: 2,
      updatedAt: 2,
    })
    const summaries = stackSummaries(state)
    expect(summaries).toHaveLength(2)
    expect(summaries[0]?.title).toBe("A")
    expect(summaries[0]?.memberCount).toBe(2)
    expect(summaries[1]?.title).toBe("B")
    expect(summaries[1]?.memberCount).toBe(2)
  })

  test("excludes deleted stacks", () => {
    const state = createEmptyState()
    state.stacksById.set("s1", {
      id: "s1",
      title: "Gone",
      projectIds: ["p1", "p2"],
      createdAt: 1,
      updatedAt: 2,
      deletedAt: 2,
    })
    expect(stackSummaries(state)).toEqual([])
  })
})

describe("deriveChatSnapshot resolvedBindings", () => {
  function buildSnapshot(state: ReturnType<typeof createEmptyState>, chatId: string) {
    return deriveChatSnapshot(
      state,
      new Map(),
      new Set(),
      new Set(),
      chatId,
      () => ({ messages: [], history: { hasOlder: false, olderCursor: null, recentLimit: 200 } }),
      () => [],
    )
  }

  function seedStackChat(opts: { p2Deleted?: boolean } = {}) {
    const state = createEmptyState()
    state.projectsById.set("p1", { id: "p1", localPath: "/p1", title: "Backend", createdAt: 1, updatedAt: 1 })
    state.projectsById.set("p2", {
      id: "p2",
      localPath: "/p2",
      title: "Frontend",
      createdAt: 1,
      updatedAt: 1,
      ...(opts.p2Deleted ? { deletedAt: 2 } : {}),
    })
    state.chatsById.set("c1", {
      id: "c1",
      projectId: "p1",
      title: "Integration",
      createdAt: 1,
      updatedAt: 1,
      unread: false,
      provider: "claude",
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      lastTurnOutcome: null,
      stackId: "s1",
      stackBindings: [
        { projectId: "p1", worktreePath: "/p1", role: "primary" },
        { projectId: "p2", worktreePath: "/p2", role: "additional" },
      ],
    })
    return state
  }

  test("includes resolvedBindings when chat has stackBindings", () => {
    const state = seedStackChat()
    const snapshot = buildSnapshot(state, "c1")
    expect(snapshot?.resolvedBindings).toEqual([
      { projectId: "p1", projectTitle: "Backend", worktreePath: "/p1", role: "primary", projectStatus: "active" },
      { projectId: "p2", projectTitle: "Frontend", worktreePath: "/p2", role: "additional", projectStatus: "active" },
    ])
  })

  test("marks deleted peer projects as projectStatus: missing", () => {
    const state = seedStackChat({ p2Deleted: true })
    const snapshot = buildSnapshot(state, "c1")
    expect(snapshot?.resolvedBindings?.[1]).toEqual({
      projectId: "p2",
      projectTitle: "Frontend",
      worktreePath: "/p2",
      role: "additional",
      projectStatus: "missing",
    })
  })

  test("omits resolvedBindings on a solo chat", () => {
    const state = createEmptyState()
    state.projectsById.set("p1", { id: "p1", localPath: "/p1", title: "Solo", createdAt: 1, updatedAt: 1 })
    state.chatsById.set("c1", {
      id: "c1",
      projectId: "p1",
      title: "T",
      createdAt: 1,
      updatedAt: 1,
      unread: false,
      provider: "claude",
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      lastTurnOutcome: null,
    })
    const snapshot = buildSnapshot(state, "c1")
    expect(snapshot?.resolvedBindings).toBeUndefined()
  })
})

describe("canForkChat", () => {
  function makeChat(overrides: Partial<ChatRecord>): ChatRecord {
    return {
      id: "c",
      projectId: "p",
      title: "t",
      createdAt: 0,
      updatedAt: 0,
      unread: false,
      provider: "claude" as AgentProvider,
      planMode: false,
      sessionTokensByProvider: {},
      sourceHash: null,
      pendingForkSessionToken: null,
      lastTurnOutcome: null,
      ...overrides,
    }
  }

  test("true when current provider slot has a token", () => {
    const chat = makeChat({ provider: "claude", sessionTokensByProvider: { claude: "x" } })
    expect(canForkChat(chat, new Map(), new Set())).toBe(true)
  })

  test("true when pendingForkSessionToken matches current provider", () => {
    const chat = makeChat({
      provider: "claude",
      sessionTokensByProvider: {},
      pendingForkSessionToken: { provider: "claude", token: "x" },
    })
    expect(canForkChat(chat, new Map(), new Set())).toBe(true)
  })

  test("false when no tokens anywhere", () => {
    const chat = makeChat({ provider: "claude", sessionTokensByProvider: {} })
    expect(canForkChat(chat, new Map(), new Set())).toBe(false)
  })

  test("false when only another provider has a token", () => {
    const chat = makeChat({ provider: "claude", sessionTokensByProvider: { codex: "x" } })
    expect(canForkChat(chat, new Map(), new Set())).toBe(false)
  })

  test("false when pendingFork is for another provider", () => {
    const chat = makeChat({
      provider: "claude",
      sessionTokensByProvider: {},
      pendingForkSessionToken: { provider: "codex", token: "x" },
    })
    expect(canForkChat(chat, new Map(), new Set())).toBe(false)
  })
})
