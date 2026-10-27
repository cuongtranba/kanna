import { describe, expect, test } from "bun:test"
import {
  applyProjectCommandsSnapshot,
  applySidebarProjectOrder,
  countMatchingUserPrompts,
  getActiveChatSnapshot,
  getNextMeasuredInputHeight,
  getPreviousPrompt,
  getTranscriptPaddingBottom,
  getUserPromptSignature,
  pruneOptimisticOnQueuedAck,
  reconcileOptimisticUserPrompts,
  resolveComposeIntent,
  shouldMarkActiveChatRead,
  shouldAutoFollowTranscript,
} from "./useKannaState"
import { EMPTY_CHAT_ACTIVITY } from "../../shared/types"
import type { ChatAttachment, ChatSnapshot, SidebarData, UserPromptEntry } from "../../shared/types"
import { useSlashCommandsStore } from "../stores/slashCommandsStore"

function createSidebarData(): SidebarData {
  return {
    starredProjectGroups: [],
    projectGroups: [
      {
        groupKey: "project-1",
        localPath: "/tmp/project-1",
        chats: [
          {
            _id: "row-1",
            _creationTime: 3,
            chatId: "chat-3",
            title: "Newest",
            status: "idle",
            unread: false,
            localPath: "/tmp/project-1",
            provider: null,
            lastMessageAt: 3,
            activity: EMPTY_CHAT_ACTIVITY,
            sessionState: "cold",
            hasPolicyOverride: false,
          },
          {
            _id: "row-2",
            _creationTime: 2,
            chatId: "chat-2",
            title: "Older",
            status: "idle",
            unread: false,
            localPath: "/tmp/project-1",
            provider: null,
            lastMessageAt: 2,
            activity: EMPTY_CHAT_ACTIVITY,
            sessionState: "cold",
            hasPolicyOverride: false,
          },
          {
            _id: "row-3",
            _creationTime: 1,
            chatId: "chat-1",
            title: "Oldest",
            status: "idle",
            unread: false,
            localPath: "/tmp/project-1",
            provider: null,
            lastMessageAt: 1,
            activity: EMPTY_CHAT_ACTIVITY,
            sessionState: "cold",
            hasPolicyOverride: false,
          },
        ],
        previewChats: [],
        olderChats: [],
        defaultCollapsed: false,
      },
      {
        groupKey: "project-2",
        localPath: "/tmp/project-2",
        chats: [
          {
            _id: "row-4",
            _creationTime: 1,
            chatId: "chat-4",
            title: "Other project",
            status: "idle",
            unread: false,
            localPath: "/tmp/project-2",
            provider: null,
            lastMessageAt: 1,
            activity: EMPTY_CHAT_ACTIVITY,
            sessionState: "cold",
            hasPolicyOverride: false,
          },
        ],
        previewChats: [],
        olderChats: [],
        defaultCollapsed: true,
      },
    ],
    stacks: [],
  }
}

describe("applySidebarProjectOrder", () => {
  test("reorders project groups immediately using the optimistic order", () => {
    const sidebarData = createSidebarData()

    expect(
      applySidebarProjectOrder(sidebarData.projectGroups, ["project-2", "project-1"]).map((group) => group.groupKey)
    ).toEqual(["project-2", "project-1"])
  })

  test("keeps unspecified groups at the end and ignores unknown ids", () => {
    const sidebarData = createSidebarData()
    const reordered = applySidebarProjectOrder(sidebarData.projectGroups, ["missing", "project-2"])

    expect(reordered.map((group) => group.groupKey)).toEqual(["project-2", "project-1"])
  })

  test("returns the original array when the order already matches", () => {
    const sidebarData = createSidebarData()
    const reordered = applySidebarProjectOrder(sidebarData.projectGroups, ["project-1", "project-2"])

    expect(reordered).toBe(sidebarData.projectGroups)
  })
})

describe("shouldAutoFollowTranscript", () => {
  test("returns true when the transcript is at the bottom", () => {
    expect(shouldAutoFollowTranscript(0)).toBe(true)
  })

  test("returns true when the transcript is near the bottom", () => {
    expect(shouldAutoFollowTranscript(23)).toBe(true)
  })

  test("returns false when the transcript is not near the bottom", () => {
    expect(shouldAutoFollowTranscript(24)).toBe(false)
  })
})

describe("getTranscriptPaddingBottom", () => {
  test("keeps the extra bottom offset even when the input height is zero", () => {
    expect(getTranscriptPaddingBottom(0)).toBe(30)
  })

  test("adds the fixed offset to the measured input height", () => {
    expect(getTranscriptPaddingBottom(140)).toBe(170)
  })

  test("scales linearly as the composer grows", () => {
    expect(getTranscriptPaddingBottom(200) - getTranscriptPaddingBottom(140)).toBe(60)
  })
})

describe("getNextMeasuredInputHeight", () => {
  test("keeps the previous height when a transient zero measurement is reported", () => {
    expect(getNextMeasuredInputHeight(148, 0)).toBe(148)
  })

  test("accepts the latest non-zero measurement", () => {
    expect(getNextMeasuredInputHeight(148, 178)).toBe(178)
  })
})

describe("shouldMarkActiveChatRead", () => {
  test("returns true only when the page is visible and focused", () => {
    expect(shouldMarkActiveChatRead({
      getVisibilityState: () => "visible" as DocumentVisibilityState,
      hasFocus: () => true,
    })).toBe(true)

    expect(shouldMarkActiveChatRead({
      getVisibilityState: () => "hidden" as DocumentVisibilityState,
      hasFocus: () => true,
    })).toBe(false)

    expect(shouldMarkActiveChatRead({
      getVisibilityState: () => "visible" as DocumentVisibilityState,
      hasFocus: () => false,
    })).toBe(false)
  })
})

describe("resolveComposeIntent", () => {
  test("prefers the selected project when available", () => {
    expect(
      resolveComposeIntent({
        selectedProjectId: "project-selected",
        sidebarProjectId: "project-sidebar",
        fallbackLocalProjectPath: "/tmp/project",
      })
    ).toEqual({ kind: "project_id", projectId: "project-selected" })
  })

  test("falls back to the first sidebar project", () => {
    expect(
      resolveComposeIntent({
        selectedProjectId: null,
        sidebarProjectId: "project-sidebar",
        fallbackLocalProjectPath: "/tmp/project",
      })
    ).toEqual({ kind: "project_id", projectId: "project-sidebar" })
  })

  test("uses the first local project path when no project is selected", () => {
    expect(
      resolveComposeIntent({
        selectedProjectId: null,
        sidebarProjectId: null,
        fallbackLocalProjectPath: "/tmp/project",
      })
    ).toEqual({ kind: "local_path", localPath: "/tmp/project" })
  })

  test("returns null when no project target exists", () => {
    expect(
      resolveComposeIntent({
        selectedProjectId: null,
        sidebarProjectId: null,
        fallbackLocalProjectPath: null,
      })
    ).toBeNull()
  })
})

describe("getActiveChatSnapshot", () => {
  test("returns the snapshot when it matches the active chat id", () => {
    const snapshot: ChatSnapshot = {
      runtime: {
        chatId: "chat-1",
        projectId: "project-1",
        localPath: "/tmp/project-1",
        title: "Chat 1",
        status: "idle",
        isDraining: false,
        provider: "codex",
        planMode: false,
        sessionTokensByProvider: {},
        timings: { activeSessionStartedAt: 0, chatCreatedAt: 0, stateEnteredAt: 0, lastTurnDurationMs: null, derivedAtMs: 0, cumulativeMs: { idle: 0, starting: 0, running: 0, waiting_for_user: 0, failed: 0 } },
        policyOverride: null,
        sessionState: "cold",
        backgroundTasks: [],
      },
      queuedMessages: [],
      messages: [],
      history: {
        hasOlder: false,
        olderCursor: null,
        recentLimit: 200,
      },
      availableProviders: [],
      schedules: {},
      liveScheduleId: null,
      tunnels: {},
      liveTunnelId: null,
      subagentRuns: {},
      loopProgress: { chatId: "c", armed: false, rows: [], rateLimit: null, completed: 0, total: 0 },
    cronJobs: [],
    }

    expect(getActiveChatSnapshot(snapshot, "chat-1")).toEqual(snapshot)
  })

  test("returns null for a stale snapshot from a previous route", () => {
    const snapshot: ChatSnapshot = {
      runtime: {
        chatId: "chat-old",
        projectId: "project-1",
        localPath: "/tmp/project-1",
        title: "Old chat",
        status: "idle",
        isDraining: false,
        provider: "claude",
        planMode: false,
        sessionTokensByProvider: {},
        timings: { activeSessionStartedAt: 0, chatCreatedAt: 0, stateEnteredAt: 0, lastTurnDurationMs: null, derivedAtMs: 0, cumulativeMs: { idle: 0, starting: 0, running: 0, waiting_for_user: 0, failed: 0 } },
        policyOverride: null,
        sessionState: "cold",
        backgroundTasks: [],
      },
      queuedMessages: [],
      messages: [],
      history: {
        hasOlder: false,
        olderCursor: null,
        recentLimit: 200,
      },
      availableProviders: [],
      schedules: {},
      liveScheduleId: null,
      tunnels: {},
      liveTunnelId: null,
      subagentRuns: {},
      loopProgress: { chatId: "c", armed: false, rows: [], rateLimit: null, completed: 0, total: 0 },
    cronJobs: [],
    }

    expect(getActiveChatSnapshot(snapshot, "chat-new")).toBeNull()
  })
})

describe("getPreviousPrompt", () => {
  test("returns the latest non-empty user prompt", () => {
    expect(getPreviousPrompt([
      {
        kind: "assistant_text",
        text: "hello",
        id: "assistant-1",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      {
        kind: "user_prompt",
        content: "first prompt",
        id: "user-1",
        timestamp: "2024-01-01T00:00:01.000Z",
      },
      {
        kind: "user_prompt",
        content: "   ",
        id: "user-2",
        timestamp: "2024-01-01T00:00:02.000Z",
      },
      {
        kind: "user_prompt",
        content: "second prompt",
        id: "user-3",
        timestamp: "2024-01-01T00:00:03.000Z",
      },
    ])).toBe("second prompt")
  })
})

describe("optimistic user prompts", () => {
  function createUserPrompt(
    id: string,
    content: string,
    attachments: ChatAttachment[] = [],
  ): UserPromptEntry {
    return {
      _id: id,
      createdAt: 1,
      kind: "user_prompt",
      content,
      attachments,
    }
  }

  test("counts matching prompts by content and attachments", () => {
    const attachment: ChatAttachment = {
      id: "att-1",
      kind: "file",
      displayName: "spec.txt",
      absolutePath: "/tmp/spec.txt",
      relativePath: "spec.txt",
      contentUrl: "/uploads/spec.txt",
      mimeType: "text/plain",
      size: 12,
    }
    const signature = getUserPromptSignature("Review this", [attachment])

    expect(countMatchingUserPrompts([
      createUserPrompt("msg-1", "Review this", [attachment]),
      createUserPrompt("msg-2", "Review this"),
    ], signature)).toBe(1)
  })

  test("reconciles duplicate optimistic prompts in order", () => {
    const optimisticPrompts = [
      {
        id: "opt-1",
        scopeId: "chat-1",
        signature: getUserPromptSignature("same"),
        requiredMatchCount: 1,
        entry: createUserPrompt("optimistic:1", "same"),
      },
      {
        id: "opt-2",
        scopeId: "chat-1",
        signature: getUserPromptSignature("same"),
        requiredMatchCount: 2,
        entry: createUserPrompt("optimistic:2", "same"),
      },
    ]

    expect(reconcileOptimisticUserPrompts(
      optimisticPrompts,
      "chat-1",
      [createUserPrompt("server-1", "same")],
    )).toEqual([optimisticPrompts[1]])
  })

  test("does not reconcile prompts from other chat scopes", () => {
    const optimisticPrompt = {
      id: "opt-1",
      scopeId: "chat-2",
      signature: getUserPromptSignature("same"),
      requiredMatchCount: 1,
      entry: createUserPrompt("optimistic:1", "same"),
    }

    expect(reconcileOptimisticUserPrompts(
      [optimisticPrompt],
      "chat-1",
      [createUserPrompt("server-1", "same")],
    )).toEqual([optimisticPrompt])
  })

  describe("pruneOptimisticOnQueuedAck", () => {
    const makePrompt = (id: string) => ({
      id,
      scopeId: "chat-1",
      signature: getUserPromptSignature("hi"),
      requiredMatchCount: 1,
      entry: createUserPrompt(`optimistic:${id}`, "hi"),
    })

    test("drops optimistic with matching id when server queued the message", () => {
      const a = makePrompt("opt-1")
      const b = makePrompt("opt-2")
      expect(pruneOptimisticOnQueuedAck([a, b], "opt-1", { queued: true })).toEqual([b])
    })

    test("returns input unchanged when ack is not queued", () => {
      const a = makePrompt("opt-1")
      const prompts = [a]
      expect(pruneOptimisticOnQueuedAck(prompts, "opt-1", { queued: false })).toBe(prompts)
      expect(pruneOptimisticOnQueuedAck(prompts, "opt-1", {})).toBe(prompts)
    })

    test("returns input unchanged when no optimistic id matches", () => {
      const a = makePrompt("opt-1")
      const prompts = [a]
      expect(pruneOptimisticOnQueuedAck(prompts, "opt-missing", { queued: true })).toBe(prompts)
    })
  })
})

describe("applyProjectCommandsSnapshot", () => {
  test("writes the commands under the project id", () => {
    useSlashCommandsStore.setState({ byProjectId: {} })
    applyProjectCommandsSnapshot("p1", {
      projectId: "p1",
      commands: [{ name: "deploy", description: "", argumentHint: "" }],
    })
    expect(useSlashCommandsStore.getState().byProjectId.p1).toEqual([
      { name: "deploy", description: "", argumentHint: "" },
    ])
  })

  test("ignores a snapshot for a different project", () => {
    useSlashCommandsStore.setState({ byProjectId: {} })
    applyProjectCommandsSnapshot("p1", {
      projectId: "p2",
      commands: [{ name: "stale", description: "", argumentHint: "" }],
    })
    expect(useSlashCommandsStore.getState().byProjectId).toEqual({})
  })

  test("ignores a null snapshot", () => {
    useSlashCommandsStore.setState({ byProjectId: {} })
    applyProjectCommandsSnapshot("p1", null)
    expect(useSlashCommandsStore.getState().byProjectId).toEqual({})
  })
})

