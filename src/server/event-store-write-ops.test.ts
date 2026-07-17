import { describe, expect, test } from "bun:test"
import type { ToolRequest } from "../shared/permission-policy"
import type { ChatRecord, ProjectRecord, StackRecord } from "./events"
import {
  buildAddProjectToStackEvent,
  buildArchiveChatEvent,
  buildChatProviderEvent,
  buildChatReadStateEvent,
  buildChatSourceHashEvent,
  buildCompactFailuresEvent,
  buildCreateChatEvent,
  buildCreateStackEvent,
  buildEnqueueMessageResult,
  buildOpenProjectResult,
  buildPendingForkSessionTokenEvent,
  buildPlanModeEvent,
  buildPutToolRequestEvent,
  buildRemoveProjectEvent,
  buildRemoveProjectFromStackEvent,
  buildRemoveQueuedMessageEvent,
  buildRemoveStackEvent,
  buildRenameStackEvent,
  buildRenameChatEvent,
  buildResolveToolRequestEvent,
  buildSetProjectStarEvent,
  buildTurnCancelledEvent,
  buildTurnFailedEvent,
  buildTurnFinishedEvent,
  buildTurnStartedEvent,
  buildUnarchiveChatEvent,
  computeNewSidebarOrder,
} from "./event-store-write-ops"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TS = 1_700_000_000_000

function makeChat(overrides?: Partial<ChatRecord>): ChatRecord {
  return {
    id: "chat-1",
    projectId: "proj-1",
    title: "Chat One",
    createdAt: TS,
    updatedAt: TS,
    unread: false,
    provider: null,
    planMode: false,
    sessionTokensByProvider: {},
    sourceHash: null,
    pendingForkSessionToken: null,
    hasMessages: false,
    lastTurnOutcome: null,
    ...overrides,
  }
}

function makeStack(overrides?: Partial<StackRecord>): StackRecord {
  return {
    id: "stack-1",
    title: "Stack One",
    projectIds: ["proj-1", "proj-2"],
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  }
}

function makeProject(id: string): ProjectRecord {
  return { id, localPath: `/tmp/${id}`, title: id, createdAt: TS, updatedAt: TS }
}

function makeProjectsById(ids: string[] = ["proj-1", "proj-2"]): Map<string, ProjectRecord> {
  return new Map(ids.map((id) => [id, makeProject(id)]))
}

function makeToolRequest(overrides?: Partial<ToolRequest>): ToolRequest {
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
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// buildOpenProjectResult
// ---------------------------------------------------------------------------

describe("buildOpenProjectResult", () => {
  test("returns existing project when already known", () => {
    const existing = makeProject("proj-1")
    const state = {
      projectsById: new Map([["proj-1", existing]]),
      projectIdsByPath: new Map([[existing.localPath, "proj-1"]]),
    }
    const result = buildOpenProjectResult(state, "/tmp/proj-1")
    expect(result.kind).toBe("existing")
    if (result.kind === "existing") {
      expect(result.project).toBe(existing)
    }
  })

  test("returns new event for unknown path", () => {
    const state = {
      projectsById: new Map<string, ProjectRecord>(),
      projectIdsByPath: new Map<string, string>(),
    }
    const result = buildOpenProjectResult(state, "/tmp/new-project", "My Project")
    expect(result.kind).toBe("new")
    if (result.kind === "new") {
      expect(result.event.type).toBe("project_opened")
      expect(result.event.title).toBe("My Project")
    }
  })

  test("uses path basename when no title given", () => {
    const state = {
      projectsById: new Map<string, ProjectRecord>(),
      projectIdsByPath: new Map<string, string>(),
    }
    const result = buildOpenProjectResult(state, "/home/user/my-repo")
    expect(result.kind).toBe("new")
    if (result.kind === "new") {
      expect(result.event.title).toBe("my-repo")
    }
  })
})

// ---------------------------------------------------------------------------
// buildRemoveProjectEvent
// ---------------------------------------------------------------------------

describe("buildRemoveProjectEvent", () => {
  test("returns project_removed event", () => {
    const projectsById = new Map([["proj-1", makeProject("proj-1")]])
    const event = buildRemoveProjectEvent(projectsById, "proj-1")
    expect(event.type).toBe("project_removed")
  })

  test("throws if project not found", () => {
    expect(() => buildRemoveProjectEvent(new Map(), "missing")).toThrow()
  })
})

// ---------------------------------------------------------------------------
// buildSetProjectStarEvent
// ---------------------------------------------------------------------------

describe("buildSetProjectStarEvent", () => {
  test("returns project_star_set event with starredAt when starring", () => {
    const projectsById = new Map([["proj-1", makeProject("proj-1")]])
    const event = buildSetProjectStarEvent(projectsById, "proj-1", true)
    expect(event.type).toBe("project_star_set")
    if (event.type === "project_star_set") {
      expect(event.starredAt).toBeGreaterThan(0)
    }
  })

  test("returns null starredAt when unstarring", () => {
    const projectsById = new Map([["proj-1", makeProject("proj-1")]])
    const event = buildSetProjectStarEvent(projectsById, "proj-1", false)
    if (event.type === "project_star_set") {
      expect(event.starredAt).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// computeNewSidebarOrder
// ---------------------------------------------------------------------------

describe("computeNewSidebarOrder", () => {
  test("returns null when order is unchanged", () => {
    const projectsById = makeProjectsById(["proj-1", "proj-2"])
    const result = computeNewSidebarOrder(projectsById, ["proj-1", "proj-2"], ["proj-1", "proj-2"])
    expect(result).toBeNull()
  })

  test("returns new order when changed", () => {
    const projectsById = makeProjectsById(["proj-1", "proj-2"])
    const result = computeNewSidebarOrder(projectsById, ["proj-1", "proj-2"], ["proj-2", "proj-1"])
    expect(result).toEqual(["proj-2", "proj-1"])
  })

  test("filters out deleted and unknown projects", () => {
    const projectsById = new Map([
      ["proj-1", makeProject("proj-1")],
      ["proj-deleted", { ...makeProject("proj-deleted"), deletedAt: TS }],
    ])
    const result = computeNewSidebarOrder(projectsById, [], ["proj-1", "proj-deleted", "unknown"])
    expect(result).toEqual(["proj-1"])
  })

  test("deduplicates", () => {
    const projectsById = makeProjectsById(["proj-1", "proj-2"])
    const result = computeNewSidebarOrder(projectsById, [], ["proj-1", "proj-1", "proj-2"])
    expect(result).toEqual(["proj-1", "proj-2"])
  })
})

// ---------------------------------------------------------------------------
// Stack builders
// ---------------------------------------------------------------------------

describe("buildCreateStackEvent", () => {
  test("builds stack_added event", () => {
    const state = { projectsById: makeProjectsById(), stacksById: new Map<string, StackRecord>() }
    const event = buildCreateStackEvent(state, "My Stack", ["proj-1", "proj-2"])
    expect(event.type).toBe("stack_added")
    expect(event.stackId).toBeDefined()
    if (event.type === "stack_added") {
      expect(event.title).toBe("My Stack")
    }
  })

  test("throws when fewer than 2 projects", () => {
    const state = { projectsById: makeProjectsById(), stacksById: new Map<string, StackRecord>() }
    expect(() => buildCreateStackEvent(state, "S", ["proj-1"])).toThrow()
  })

  test("throws when title is blank", () => {
    const state = { projectsById: makeProjectsById(), stacksById: new Map<string, StackRecord>() }
    expect(() => buildCreateStackEvent(state, "  ", ["proj-1", "proj-2"])).toThrow()
  })

  test("throws when duplicate projectIds", () => {
    const state = { projectsById: makeProjectsById(["proj-1"]), stacksById: new Map<string, StackRecord>() }
    expect(() => buildCreateStackEvent(state, "S", ["proj-1", "proj-1"])).toThrow()
  })
})

describe("buildRenameStackEvent", () => {
  test("returns null when title unchanged", () => {
    const stacksById = new Map([["stack-1", makeStack()]])
    expect(buildRenameStackEvent(stacksById, "stack-1", "Stack One")).toBeNull()
  })

  test("returns event when title changed", () => {
    const stacksById = new Map([["stack-1", makeStack()]])
    const event = buildRenameStackEvent(stacksById, "stack-1", "New Name")
    expect(event?.type).toBe("stack_renamed")
    if (event?.type === "stack_renamed") {
      expect(event.title).toBe("New Name")
    }
  })
})

describe("buildRemoveStackEvent", () => {
  test("returns stack_removed event", () => {
    const stacksById = new Map([["stack-1", makeStack()]])
    const event = buildRemoveStackEvent(stacksById, "stack-1")
    expect(event?.type).toBe("stack_removed")
  })

  test("returns null if already deleted", () => {
    const stacksById = new Map([["stack-1", makeStack({ deletedAt: TS })]])
    expect(buildRemoveStackEvent(stacksById, "stack-1")).toBeNull()
  })
})

describe("buildAddProjectToStackEvent", () => {
  test("returns null if project already in stack", () => {
    const state = {
      projectsById: makeProjectsById(["proj-1", "proj-2"]),
      stacksById: new Map([["stack-1", makeStack({ projectIds: ["proj-1", "proj-2"] })]]),
    }
    expect(buildAddProjectToStackEvent(state, "stack-1", "proj-1")).toBeNull()
  })

  test("returns event when project not yet in stack", () => {
    const state = {
      projectsById: makeProjectsById(["proj-1", "proj-2", "proj-3"]),
      stacksById: new Map([["stack-1", makeStack({ projectIds: ["proj-1", "proj-2"] })]]),
    }
    const event = buildAddProjectToStackEvent(state, "stack-1", "proj-3")
    expect(event?.type).toBe("stack_project_added")
  })
})

describe("buildRemoveProjectFromStackEvent", () => {
  test("returns null if project not in stack", () => {
    const stacksById = new Map([["stack-1", makeStack({ projectIds: ["proj-1", "proj-2"] })]])
    expect(buildRemoveProjectFromStackEvent(stacksById, "stack-1", "proj-99")).toBeNull()
  })

  test("throws when would drop below 2 members", () => {
    const stacksById = new Map([["stack-1", makeStack({ projectIds: ["proj-1", "proj-2"] })]])
    expect(() => buildRemoveProjectFromStackEvent(stacksById, "stack-1", "proj-1")).toThrow()
  })

  test("returns event when stack has 3+ members", () => {
    const stacksById = new Map([["stack-1", makeStack({ projectIds: ["proj-1", "proj-2", "proj-3"] })]])
    const event = buildRemoveProjectFromStackEvent(stacksById, "stack-1", "proj-3")
    expect(event?.type).toBe("stack_project_removed")
  })
})

// ---------------------------------------------------------------------------
// Chat builders
// ---------------------------------------------------------------------------

describe("buildCreateChatEvent", () => {
  test("builds chat_created event", () => {
    const state = { projectsById: makeProjectsById(), stacksById: new Map<string, StackRecord>() }
    const event = buildCreateChatEvent(state, "proj-1")
    expect(event.type).toBe("chat_created")
    expect(event.chatId).toBeDefined()
    if (event.type === "chat_created") {
      expect(event.projectId).toBe("proj-1")
    }
  })

  test("throws when project not found", () => {
    const state = { projectsById: new Map<string, ProjectRecord>(), stacksById: new Map<string, StackRecord>() }
    expect(() => buildCreateChatEvent(state, "missing")).toThrow()
  })
})

describe("buildRenameChatEvent", () => {
  test("returns null if title unchanged", () => {
    const chatsById = new Map([["chat-1", makeChat({ title: "Same" })]])
    expect(buildRenameChatEvent(chatsById, "chat-1", "Same")).toBeNull()
  })

  test("returns null if title is blank", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    expect(buildRenameChatEvent(chatsById, "chat-1", "   ")).toBeNull()
  })

  test("returns event when title changed", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    const event = buildRenameChatEvent(chatsById, "chat-1", "New Name")
    expect(event?.type).toBe("chat_renamed")
  })
})

describe("buildArchiveChatEvent / buildUnarchiveChatEvent", () => {
  test("archive returns chat_archived", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    expect(buildArchiveChatEvent(chatsById, "chat-1").type).toBe("chat_archived")
  })

  test("unarchive returns chat_unarchived", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    expect(buildUnarchiveChatEvent(chatsById, "chat-1").type).toBe("chat_unarchived")
  })

  test("throws if chat not found", () => {
    expect(() => buildArchiveChatEvent(new Map(), "missing")).toThrow()
  })
})

describe("buildChatProviderEvent", () => {
  test("returns null if provider unchanged", () => {
    const chatsById = new Map([["chat-1", makeChat({ provider: "claude" })]])
    expect(buildChatProviderEvent(chatsById, "chat-1", "claude")).toBeNull()
  })

  test("returns event when provider changes", () => {
    const chatsById = new Map([["chat-1", makeChat({ provider: null })]])
    const event = buildChatProviderEvent(chatsById, "chat-1", "claude")
    expect(event?.type).toBe("chat_provider_set")
  })
})

describe("buildPlanModeEvent", () => {
  test("returns null if planMode unchanged", () => {
    const chatsById = new Map([["chat-1", makeChat({ planMode: false })]])
    expect(buildPlanModeEvent(chatsById, "chat-1", false)).toBeNull()
  })

  test("returns event when planMode changes", () => {
    const chatsById = new Map([["chat-1", makeChat({ planMode: false })]])
    expect(buildPlanModeEvent(chatsById, "chat-1", true)?.type).toBe("chat_plan_mode_set")
  })
})

describe("buildCompactFailuresEvent", () => {
  test("returns null if count unchanged", () => {
    const chatsById = new Map([["chat-1", makeChat({ compactFailureCount: 0 })]])
    expect(buildCompactFailuresEvent(chatsById, "chat-1", 0)).toBeNull()
  })

  test("returns event when count changes", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    expect(buildCompactFailuresEvent(chatsById, "chat-1", 1)?.type).toBe("chat_compact_failures_set")
  })
})

describe("buildChatReadStateEvent", () => {
  test("returns null if unread unchanged", () => {
    const chatsById = new Map([["chat-1", makeChat({ unread: false })]])
    expect(buildChatReadStateEvent(chatsById, "chat-1", false)).toBeNull()
  })

  test("returns event when unread changes", () => {
    const chatsById = new Map([["chat-1", makeChat({ unread: false })]])
    expect(buildChatReadStateEvent(chatsById, "chat-1", true)?.type).toBe("chat_read_state_set")
  })
})

describe("buildChatSourceHashEvent", () => {
  test("returns null if sourceHash unchanged", () => {
    const chatsById = new Map([["chat-1", makeChat({ sourceHash: "abc" })]])
    expect(buildChatSourceHashEvent(chatsById, "chat-1", "abc")).toBeNull()
  })

  test("returns event when sourceHash changes", () => {
    const chatsById = new Map([["chat-1", makeChat({ sourceHash: null })]])
    expect(buildChatSourceHashEvent(chatsById, "chat-1", "abc")?.type).toBe("chat_source_hash_set")
  })
})

// ---------------------------------------------------------------------------
// Queued message builders
// ---------------------------------------------------------------------------

describe("buildEnqueueMessageResult", () => {
  test("builds event and queuedMessage with generated id", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    const { event, queuedMessage } = buildEnqueueMessageResult(chatsById, "chat-1", {
      content: "hello",
      attachments: [],
      provider: "claude",
      model: "claude-3-5-sonnet",
    })
    expect(event.type).toBe("queued_message_enqueued")
    expect(queuedMessage.id).toBeDefined()
    expect(queuedMessage.content).toBe("hello")
  })

  test("uses provided id if given", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    const { queuedMessage } = buildEnqueueMessageResult(chatsById, "chat-1", {
      id: "fixed-id",
      content: "hello",
      attachments: [],
      provider: "claude",
      model: "claude-3-5-sonnet",
    })
    expect(queuedMessage.id).toBe("fixed-id")
  })
})

describe("buildRemoveQueuedMessageEvent", () => {
  test("returns queued_message_removed event", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    const queuedMessagesByChatId = new Map([
      ["chat-1", [{ id: "msg-1", content: "hi", attachments: [], createdAt: TS, provider: "claude" as const, model: "m" }]],
    ])
    const event = buildRemoveQueuedMessageEvent(chatsById, queuedMessagesByChatId, "chat-1", "msg-1")
    expect(event.type).toBe("queued_message_removed")
    if (event.type === "queued_message_removed") {
      expect(event.queuedMessageId).toBe("msg-1")
    }
  })

  test("throws if message not found", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    const empty = new Map<string, { id: string; content: string; attachments: []; createdAt: number; provider: "claude"; model: string }[]>()
    expect(() => buildRemoveQueuedMessageEvent(chatsById, empty, "chat-1", "missing")).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Turn builders
// ---------------------------------------------------------------------------

describe("buildTurnStartedEvent", () => {
  test("builds turn_started", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    expect(buildTurnStartedEvent(chatsById, "chat-1").type).toBe("turn_started")
  })

  test("throws if chat not found", () => {
    expect(() => buildTurnStartedEvent(new Map(), "missing")).toThrow()
  })
})

describe("buildTurnFinishedEvent", () => {
  test("builds turn_finished", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    expect(buildTurnFinishedEvent(chatsById, "chat-1").type).toBe("turn_finished")
  })
})

describe("buildTurnFailedEvent", () => {
  test("builds turn_failed with error", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    const event = buildTurnFailedEvent(chatsById, "chat-1", "some error")
    expect(event.type).toBe("turn_failed")
    if (event.type === "turn_failed") {
      expect(event.error).toBe("some error")
    }
  })
})

describe("buildTurnCancelledEvent", () => {
  test("builds turn_cancelled", () => {
    const chatsById = new Map([["chat-1", makeChat()]])
    expect(buildTurnCancelledEvent(chatsById, "chat-1").type).toBe("turn_cancelled")
  })
})

describe("buildPendingForkSessionTokenEvent", () => {
  test("returns null if token unchanged (both null)", () => {
    const chatsById = new Map([["chat-1", makeChat({ pendingForkSessionToken: null })]])
    expect(buildPendingForkSessionTokenEvent(chatsById, "chat-1", null)).toBeNull()
  })

  test("returns event when setting a token", () => {
    const chatsById = new Map([["chat-1", makeChat({ pendingForkSessionToken: null })]])
    const event = buildPendingForkSessionTokenEvent(chatsById, "chat-1", { provider: "claude", token: "tok-abc" })
    expect(event?.type).toBe("pending_fork_session_token_set")
  })
})

// ---------------------------------------------------------------------------
// Tool-request builders
// ---------------------------------------------------------------------------

describe("buildPutToolRequestEvent", () => {
  test("builds tool_request_put", () => {
    const event = buildPutToolRequestEvent(makeToolRequest())
    expect(event.type).toBe("tool_request_put")
  })
})

describe("buildResolveToolRequestEvent", () => {
  test("builds tool_request_resolved", () => {
    const toolRequestsById = new Map([["req-1", makeToolRequest()]])
    const event = buildResolveToolRequestEvent(toolRequestsById, "req-1", {
      status: "answered",
      resolvedAt: TS,
    })
    expect(event.type).toBe("tool_request_resolved")
  })

  test("throws if id unknown", () => {
    expect(() =>
      buildResolveToolRequestEvent(new Map(), "unknown", { status: "answered", resolvedAt: TS }),
    ).toThrow()
  })
})
