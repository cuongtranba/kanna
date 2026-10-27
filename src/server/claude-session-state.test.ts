
import { describe, it, expect } from "bun:test"
import { ClaudeSessionState } from "./claude-session-state"

function makeHandle(): import("./harness-types").ClaudeSessionHandle {
  return {
    provider: "claude",
    stream: (async function* () {})(),
    interrupt: async () => {},
    close: () => {},
    closed: Promise.resolve(),
    sendPrompt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
  }
}

function makeSession(overrides?: Partial<ConstructorParameters<typeof ClaudeSessionState>[0]>): ClaudeSessionState {
  return new ClaudeSessionState({
    id: "sess-1",
    chatId: "chat-1",
    session: makeHandle(),
    localPath: "/tmp",
    additionalDirectories: [],
    model: "claude-3-opus",
    planMode: false,
    sessionToken: null,
    accountInfoLoaded: false,
    nextPromptSeq: 0,
    pendingPromptSeqs: [],
    activeTokenId: null,
    oauthKeyMasked: null,
    oauthLabel: null,
    endpointKeyMasked: null,
    endpointModel: null,
    lastUsedAt: 0,
    backgroundTasks: new Map(),
    backgroundTaskDeadlineAt: 0,
    backgroundTaskWakeCount: 0,
    backgroundTasksLevelSourced: false,
    selfWakeActive: false,
    recentToolDescriptions: new Map(),
    backgroundLaunchToolIds: new Set(),
    loopArmedAtSpawn: false,
    cancelledResultPending: 0,
    suppressSessionTokenPersist: false,
    backgroundTaskWakeSuppressed: false,
    ...overrides,
  })
}

const NOW = 1_000_000
const MAX_MS = 30_000

describe("ClaudeSessionState.isHoldingWork", () => {
  it("returns false when backgroundTasks is empty", () => {
    const s = makeSession()
    expect(s.isHoldingWork(NOW)).toBe(false)
  })

  it("returns false when deadline has lapsed and not level-sourced", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskDeadlineAt: NOW - 1,
      backgroundTasksLevelSourced: false,
    })
    expect(s.isHoldingWork(NOW)).toBe(false)
  })

  it("returns true when deadline is in the future and not level-sourced", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskDeadlineAt: NOW + 1,
      backgroundTasksLevelSourced: false,
    })
    expect(s.isHoldingWork(NOW)).toBe(true)
  })

  it("returns true when level-sourced regardless of deadline", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskDeadlineAt: 0,
      backgroundTasksLevelSourced: true,
    })
    expect(s.isHoldingWork(NOW)).toBe(true)
  })
})

describe("ClaudeSessionState.guardExpired", () => {
  it("returns false when backgroundTasks is empty", () => {
    const s = makeSession()
    expect(s.guardExpired(NOW)).toBe(false)
  })

  it("returns false when level-sourced (held indefinitely)", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskDeadlineAt: 0,
      backgroundTasksLevelSourced: true,
    })
    expect(s.guardExpired(NOW)).toBe(false)
  })

  it("returns false when deadline is in the future", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskDeadlineAt: NOW + 1,
      backgroundTasksLevelSourced: false,
    })
    expect(s.guardExpired(NOW)).toBe(false)
  })

  it("returns true when deadline has lapsed and not level-sourced", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskDeadlineAt: NOW - 1,
      backgroundTasksLevelSourced: false,
    })
    expect(s.guardExpired(NOW)).toBe(true)
  })
})

describe("ClaudeSessionState.noteUserSend", () => {
  it("refreshes deadline when tasks are pending", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskDeadlineAt: NOW + 1,
      backgroundTaskWakeCount: 5,
      backgroundTaskWakeSuppressed: true,
    })
    s.noteUserSend(MAX_MS, NOW)
    expect(s.backgroundTaskDeadlineAt).toBe(NOW + MAX_MS)
    expect(s.backgroundTaskWakeCount).toBe(0)
    expect(s.backgroundTaskWakeSuppressed).toBe(false)
  })

  it("does not touch deadline when no tasks pending", () => {
    const s = makeSession({
      backgroundTaskDeadlineAt: 99,
      backgroundTaskWakeCount: 3,
      backgroundTaskWakeSuppressed: true,
    })
    s.noteUserSend(MAX_MS, NOW)
    expect(s.backgroundTaskDeadlineAt).toBe(99)
    expect(s.backgroundTaskWakeCount).toBe(3)
    expect(s.backgroundTaskWakeSuppressed).toBe(false)
  })

  it("always clears backgroundTaskWakeSuppressed", () => {
    const s = makeSession({ backgroundTaskWakeSuppressed: true })
    s.noteUserSend(MAX_MS, NOW)
    expect(s.backgroundTaskWakeSuppressed).toBe(false)
  })
})

describe("ClaudeSessionState.noteLaunch", () => {
  it("returns empty array when launches is empty", () => {
    const s = makeSession()
    const added = s.noteLaunch([], null, MAX_MS, NOW)
    expect(added).toEqual([])
  })

  it("adds a new task and refreshes deadline", () => {
    const s = makeSession()
    const added = s.noteLaunch([{ id: "task-1", outputPath: "/tmp/out" }], "some cmd", MAX_MS, NOW)
    expect(added).toEqual([{ id: "task-1", outputPath: "/tmp/out" }])
    expect(s.backgroundTasks.has("task-1")).toBe(true)
    expect(s.backgroundTasks.get("task-1")?.description).toBe("some cmd")
    expect(s.backgroundTasks.get("task-1")?.outputPath).toBe("/tmp/out")
    expect(s.backgroundTaskDeadlineAt).toBe(NOW + MAX_MS)
  })

  it("resets wakeCount on empty→non-empty transition", () => {
    const s = makeSession({ backgroundTaskWakeCount: 7 })
    s.noteLaunch([{ id: "task-1", outputPath: null }], null, MAX_MS, NOW)
    expect(s.backgroundTaskWakeCount).toBe(0)
  })

  it("does not reset wakeCount when already non-empty", () => {
    const s = makeSession({
      backgroundTasks: new Map([["existing", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskWakeCount: 7,
    })
    s.noteLaunch([{ id: "task-new", outputPath: null }], null, MAX_MS, NOW)
    expect(s.backgroundTaskWakeCount).toBe(7)
  })

  it("does not re-add existing task, does not include it in returned array", () => {
    const existing = { taskType: null, description: "old", startedAt: NOW - 1, outputPath: null }
    const s = makeSession({
      backgroundTasks: new Map([["task-1", existing]]),
    })
    const added = s.noteLaunch([{ id: "task-1", outputPath: null }], "new", MAX_MS, NOW)
    expect(added).toEqual([])
    expect(s.backgroundTasks.get("task-1")?.description).toBe("old")
  })

  it("updates outputPath when existing entry has null outputPath", () => {
    const existing = { taskType: null, description: null, startedAt: NOW - 1, outputPath: null }
    const s = makeSession({
      backgroundTasks: new Map([["task-1", existing]]),
    })
    const added = s.noteLaunch([{ id: "task-1", outputPath: "/new/path" }], null, MAX_MS, NOW)
    expect(added).toEqual([{ id: "task-1", outputPath: "/new/path" }])
    expect(s.backgroundTasks.get("task-1")?.outputPath).toBe("/new/path")
  })

  it("skips update when existing outputPath is already set", () => {
    const existing = { taskType: null, description: null, startedAt: NOW - 1, outputPath: "/old/path" }
    const s = makeSession({
      backgroundTasks: new Map([["task-1", existing]]),
    })
    const added = s.noteLaunch([{ id: "task-1", outputPath: "/new/path" }], null, MAX_MS, NOW)
    expect(added).toEqual([])
  })

  it("returns empty when launches has entries but none are new or updated", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: "desc", startedAt: NOW, outputPath: "/out" }]]),
    })
    const added = s.noteLaunch([{ id: "t1", outputPath: "/out" }], null, MAX_MS, NOW)
    expect(added).toEqual([])
  })
})

describe("ClaudeSessionState.noteSettle", () => {
  it("removes the settled task", () => {
    const s = makeSession({
      backgroundTasks: new Map([
        ["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }],
        ["t2", { taskType: null, description: null, startedAt: NOW, outputPath: null }],
      ]),
    })
    s.noteSettle("t1", MAX_MS, NOW)
    expect(s.backgroundTasks.has("t1")).toBe(false)
    expect(s.backgroundTasks.has("t2")).toBe(true)
  })

  it("refreshes deadline when tasks still remain", () => {
    const s = makeSession({
      backgroundTasks: new Map([
        ["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }],
        ["t2", { taskType: null, description: null, startedAt: NOW, outputPath: null }],
      ]),
      backgroundTaskDeadlineAt: 1,
    })
    s.noteSettle("t1", MAX_MS, NOW)
    expect(s.backgroundTaskDeadlineAt).toBe(NOW + MAX_MS)
  })

  it("clears deadline when no tasks remain", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskDeadlineAt: NOW + 1000,
    })
    s.noteSettle("t1", MAX_MS, NOW)
    expect(s.backgroundTaskDeadlineAt).toBe(0)
  })
})

describe("ClaudeSessionState.applyLevelSnapshot", () => {
  it("sets levelSourced true", () => {
    const s = makeSession()
    s.applyLevelSnapshot([], undefined, MAX_MS, NOW)
    expect(s.backgroundTasksLevelSourced).toBe(true)
  })

  it("replaces backgroundTasks with snapshot content", () => {
    const s = makeSession({
      backgroundTasks: new Map([["old-id", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
    })
    s.applyLevelSnapshot(["new-id"], [{ id: "new-id", taskType: "bash", description: "watch" }], MAX_MS, NOW)
    expect(s.backgroundTasks.has("old-id")).toBe(false)
    expect(s.backgroundTasks.has("new-id")).toBe(true)
    expect(s.backgroundTasks.get("new-id")?.taskType).toBe("bash")
    expect(s.backgroundTasks.get("new-id")?.description).toBe("watch")
  })

  it("resets wakeCount on empty→non-empty transition", () => {
    const s = makeSession({ backgroundTaskWakeCount: 5 })
    s.applyLevelSnapshot(["t1"], undefined, MAX_MS, NOW)
    expect(s.backgroundTaskWakeCount).toBe(0)
  })

  it("does not reset wakeCount when was already non-empty", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskWakeCount: 5,
    })
    s.applyLevelSnapshot(["t1", "t2"], undefined, MAX_MS, NOW)
    expect(s.backgroundTaskWakeCount).toBe(5)
  })

  it("sets deadline when tasks remain", () => {
    const s = makeSession({ backgroundTaskDeadlineAt: 0 })
    s.applyLevelSnapshot(["t1"], undefined, MAX_MS, NOW)
    expect(s.backgroundTaskDeadlineAt).toBe(NOW + MAX_MS)
  })

  it("clears deadline when snapshot is empty", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskDeadlineAt: NOW + 1000,
    })
    s.applyLevelSnapshot([], undefined, MAX_MS, NOW)
    expect(s.backgroundTaskDeadlineAt).toBe(0)
  })

  it("preserves startedAt from previous map", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: 123, outputPath: null }]]),
    })
    s.applyLevelSnapshot(["t1"], undefined, MAX_MS, NOW)
    expect(s.backgroundTasks.get("t1")?.startedAt).toBe(123)
  })
})

describe("ClaudeSessionState.hasBackgroundTasks", () => {
  it("returns false when map is empty", () => {
    const s = makeSession()
    expect(s.hasBackgroundTasks()).toBe(false)
  })

  it("returns true when map has entries", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
    })
    expect(s.hasBackgroundTasks()).toBe(true)
  })
})

describe("ClaudeSessionState.getBackgroundTaskEntries", () => {
  it("returns empty array when no tasks", () => {
    const s = makeSession()
    expect(s.getBackgroundTaskEntries()).toEqual([])
  })

  it("returns [id, meta] pairs matching the map", () => {
    const meta = { taskType: "bash" as const, description: "watch", startedAt: NOW, outputPath: "/out" }
    const s = makeSession({ backgroundTasks: new Map([["t1", meta]]) })
    const entries = s.getBackgroundTaskEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0][0]).toBe("t1")
    expect(entries[0][1]).toEqual(meta)
  })
})

describe("ClaudeSessionState.getBackgroundTaskIds", () => {
  it("returns empty array when no tasks", () => {
    const s = makeSession()
    expect(s.getBackgroundTaskIds()).toEqual([])
  })

  it("returns all task ids", () => {
    const s = makeSession({
      backgroundTasks: new Map([
        ["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }],
        ["t2", { taskType: null, description: null, startedAt: NOW, outputPath: null }],
      ]),
    })
    const ids = s.getBackgroundTaskIds()
    expect(ids).toHaveLength(2)
    expect(ids).toContain("t1")
    expect(ids).toContain("t2")
  })
})

describe("ClaudeSessionState.abandonBackgroundTasks", () => {
  it("returns empty array when no tasks", () => {
    const s = makeSession()
    const ids = s.abandonBackgroundTasks()
    expect(ids).toEqual([])
  })

  it("returns the ids of all tasks that were cleared", () => {
    const s = makeSession({
      backgroundTasks: new Map([
        ["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }],
        ["t2", { taskType: null, description: null, startedAt: NOW, outputPath: null }],
      ]),
      backgroundTaskDeadlineAt: NOW + 1000,
    })
    const ids = s.abandonBackgroundTasks()
    expect(ids).toHaveLength(2)
    expect(ids).toContain("t1")
    expect(ids).toContain("t2")
  })

  it("clears the task map", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
    })
    s.abandonBackgroundTasks()
    expect(s.backgroundTasks.size).toBe(0)
  })

  it("resets the deadline to 0", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
      backgroundTaskDeadlineAt: NOW + 5000,
    })
    s.abandonBackgroundTasks()
    expect(s.backgroundTaskDeadlineAt).toBe(0)
  })
})

describe("ClaudeSessionState.applyLevelSnapshot merge", () => {
  it("preserves outputPath from a previous entry when the snapshot has no path", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: 100, outputPath: "/tmp/t1.out" }]]),
    })
    s.applyLevelSnapshot(["t1"], undefined, MAX_MS, 200)
    expect(s.backgroundTasks.get("t1")?.outputPath).toBe("/tmp/t1.out")
  })

  it("gives a new task a null outputPath", () => {
    const s = makeSession()
    s.applyLevelSnapshot(["t2"], undefined, MAX_MS, 200)
    expect(s.backgroundTasks.get("t2")?.outputPath).toBeNull()
  })

  it("REPLACE semantics: absent ids drop, new ids appear with snapshot meta", () => {
    const s = makeSession({
      backgroundTasks: new Map([
        ["gone", { taskType: null, description: "stale", startedAt: 1, outputPath: null }],
        ["kept", { taskType: null, description: null, startedAt: 2, outputPath: null }],
      ]),
    })
    s.applyLevelSnapshot(
      ["kept", "fresh"],
      [
        { id: "kept", taskType: "local_bash", description: "CI watch" },
        { id: "fresh", taskType: "local_agent", description: null },
      ],
      MAX_MS,
      1_000,
    )
    expect(s.backgroundTasks.has("gone")).toBe(false)
    expect(s.backgroundTasks.get("kept")).toEqual({ taskType: "local_bash", description: "CI watch", startedAt: 2, outputPath: null })
    expect(s.backgroundTasks.get("fresh")).toEqual({ taskType: "local_agent", description: null, startedAt: 1_000, outputPath: null })
  })

  it("a snapshot without meta preserves previously learned labels", () => {
    const s = makeSession({
      backgroundTasks: new Map([["t1", { taskType: "local_bash", description: "Watch deploy", startedAt: 5, outputPath: null }]]),
    })
    s.applyLevelSnapshot(["t1"], undefined, MAX_MS, 999)
    expect(s.backgroundTasks.get("t1")).toEqual({ taskType: "local_bash", description: "Watch deploy", startedAt: 5, outputPath: null })
  })
})

describe("ClaudeSessionState cancelled-result protocol", () => {
  it("beginPrompt numbers prompts, queues them, and forgets earlier cancellations", () => {
    const s = makeSession({ nextPromptSeq: 4, cancelledResultPending: 2 })
    expect(s.beginPrompt()).toBe(5)
    expect(s.beginPrompt()).toBe(6)
    expect(s.pendingPromptSeqs).toEqual([5, 6])
    expect(s.cancelledResultPending).toBe(0)
  })

  it("completePrompt hands back the oldest outstanding prompt, or null when none is outstanding", () => {
    const s = makeSession({ pendingPromptSeqs: [3, 4] })
    expect(s.completePrompt()).toBe(3)
    expect(s.completePrompt()).toBe(4)
    expect(s.completePrompt()).toBeNull()
  })

  it("cancelPrompt drops that prompt and expects one echoed error result, even for an unknown seq", () => {
    const s = makeSession({ pendingPromptSeqs: [1, 2, 3] })
    s.cancelPrompt(2)
    expect(s.pendingPromptSeqs).toEqual([1, 3])
    expect(s.cancelledResultPending).toBe(1)
    s.cancelPrompt(9)
    expect(s.pendingPromptSeqs).toEqual([1, 3])
    expect(s.cancelledResultPending).toBe(2)
  })

  it("the echoed error result is swallowed once per cancellation and disarms the self-wake", () => {
    const s = makeSession({ cancelledResultPending: 1, selfWakeActive: true })
    expect(s.swallowCancelledErrorResult()).toBe(true)
    expect(s.cancelledResultPending).toBe(0)
    expect(s.selfWakeActive).toBe(false)
    expect(s.swallowCancelledErrorResult()).toBe(false)
  })

  it("cancelSelfWake suppresses the background wake only while tasks are outstanding", () => {
    const withTasks = makeSession({
      selfWakeActive: true,
      backgroundTasks: new Map([["t1", { taskType: null, description: null, startedAt: NOW, outputPath: null }]]),
    })
    withTasks.cancelSelfWake()
    expect(withTasks.selfWakeActive).toBe(false)
    expect(withTasks.backgroundTaskWakeSuppressed).toBe(true)
    expect(withTasks.cancelledResultPending).toBe(1)

    const withoutTasks = makeSession({ selfWakeActive: true })
    withoutTasks.cancelSelfWake()
    expect(withoutTasks.backgroundTaskWakeSuppressed).toBe(false)
    expect(withoutTasks.cancelledResultPending).toBe(1)
  })

  it("token persistence and self-wake arming are held back while a cancellation is unresolved", () => {
    const settled = makeSession()
    expect(settled.persistsSessionToken()).toBe(true)
    expect(settled.canArmSelfWake()).toBe(true)

    const cancelled = makeSession({ cancelledResultPending: 1 })
    expect(cancelled.persistsSessionToken()).toBe(false)
    expect(cancelled.canArmSelfWake()).toBe(false)

    const suppressed = makeSession({ suppressSessionTokenPersist: true, backgroundTaskWakeSuppressed: true })
    expect(suppressed.persistsSessionToken()).toBe(false)
    expect(suppressed.canArmSelfWake()).toBe(false)
  })
})
