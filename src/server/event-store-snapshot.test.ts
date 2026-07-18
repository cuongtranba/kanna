import { describe, expect, test } from "bun:test"
import type { StorageBackend } from "./storage/backend"
import type { SnapshotFile } from "./events"
import { createEmptyState } from "./events"
import { STORE_VERSION } from "../shared/types"
import {
  buildSnapshotFile,
  calcShouldTruncateLogs,
  computeLegacyTranscriptStats,
  loadAndReplayLogs,
  loadSidebarOrder,
  loadSnapshotIntoState,
  migrateLegacyTranscripts,
  readSidebarOrderFromProjectsLog,
  truncateLogsAfterSnapshot,
  writeSidebarOrderFile,
  type LegacyTranscriptStats,
  type SnapshotLogPaths,
} from "./event-store-snapshot"
import type { TranscriptEntry } from "../shared/types"
import type { StoreEvent } from "./events"

// ---------------------------------------------------------------------------
// Mock StorageBackend
// ---------------------------------------------------------------------------

function makeStorage(initial: Record<string, string> = {}): StorageBackend & {
  written: Map<string, string>
  appended: Map<string, string[]>
  renamed: Array<[string, string]>
} {
  const files = new Map<string, string>(Object.entries(initial))
  const written = new Map<string, string>()
  const appended = new Map<string, string[]>()
  const renamed: Array<[string, string]> = []

  return {
    written,
    appended,
    renamed,
    mkdir: async () => {},
    exists: async (p) => files.has(p),
    existsSync: (p) => files.has(p),
    size: async (p) => {
      const content = files.get(p)
      return content ? content.length : 0
    },
    readText: async (p) => {
      const content = files.get(p)
      if (content === undefined) throw new Error(`File not found: ${p}`)
      return content
    },
    readTextSync: (p) => {
      const content = files.get(p)
      if (content === undefined) throw new Error(`File not found: ${p}`)
      return content
    },
    writeText: async (p, content) => {
      files.set(p, content)
      written.set(p, content)
    },
    appendText: async (p, content) => {
      const existing = files.get(p) ?? ""
      files.set(p, existing + content)
      const list = appended.get(p) ?? []
      list.push(content)
      appended.set(p, list)
    },
    rename: async (from, to) => {
      const content = files.get(from)
      if (content !== undefined) {
        files.set(to, content)
        files.delete(from)
      }
      renamed.push([from, to])
    },
    remove: async (p) => { files.delete(p) },
  }
}

const PATHS: SnapshotLogPaths = {
  snapshotPath: "/data/snapshot.json",
  projectsLogPath: "/data/projects.jsonl",
  chatsLogPath: "/data/chats.jsonl",
  messagesLogPath: "/data/messages.jsonl",
  queuedMessagesLogPath: "/data/queued-messages.jsonl",
  turnsLogPath: "/data/turns.jsonl",
  schedulesLogPath: "/data/schedules.jsonl",
  stacksLogPath: "/data/stacks.jsonl",
  toolRequestsLogPath: "/data/tool-requests.jsonl",
  orchLogPath: "/data/orch.jsonl",
}

// ---------------------------------------------------------------------------
// loadSnapshotIntoState
// ---------------------------------------------------------------------------
describe("loadSnapshotIntoState", () => {
  test("returns empty result when snapshot file does not exist", async () => {
    const storage = makeStorage()
    const state = createEmptyState()
    const legacyMessages = new Map<string, TranscriptEntry[]>()
    let clearCalled = false
    const result = await loadSnapshotIntoState(
      storage, "/data/snapshot.json", state, legacyMessages,
      async () => { clearCalled = true },
    )
    expect(result).toEqual({ snapshotHasLegacyMessages: false, legacySidebarProjectOrder: [] })
    expect(clearCalled).toBe(false)
    expect(state.projectsById.size).toBe(0)
  })

  test("returns empty result when snapshot file is empty", async () => {
    const storage = makeStorage({ "/data/snapshot.json": "  " })
    const state = createEmptyState()
    const result = await loadSnapshotIntoState(
      storage, "/data/snapshot.json", state, new Map(), async () => {},
    )
    expect(result).toEqual({ snapshotHasLegacyMessages: false, legacySidebarProjectOrder: [] })
  })

  test("calls clearStorage and returns empty when version mismatches", async () => {
    const snapshot = { v: 999, generatedAt: 0, projects: [], chats: [] } as unknown as SnapshotFile
    const storage = makeStorage({ "/data/snapshot.json": JSON.stringify(snapshot) })
    const state = createEmptyState()
    let clearCalled = false
    const result = await loadSnapshotIntoState(
      storage, "/data/snapshot.json", state, new Map(),
      async () => { clearCalled = true },
    )
    expect(clearCalled).toBe(true)
    expect(result).toEqual({ snapshotHasLegacyMessages: false, legacySidebarProjectOrder: [] })
  })

  test("populates state.projectsById and projectIdsByPath from snapshot", async () => {
    const snapshot: SnapshotFile = {
      v: STORE_VERSION,
      generatedAt: 100,
      projects: [{
        id: "proj-1",
        localPath: "/home/user/project",
        title: "My Project",
        createdAt: 1,
        updatedAt: 1,
      }],
      chats: [],
    }
    const storage = makeStorage({ "/data/snapshot.json": JSON.stringify(snapshot) })
    const state = createEmptyState()
    await loadSnapshotIntoState(storage, "/data/snapshot.json", state, new Map(), async () => {})
    expect(state.projectsById.has("proj-1")).toBe(true)
    expect(state.projectIdsByPath.get("/home/user/project")).toBe("proj-1")
  })

  test("populates chatsById from snapshot", async () => {
    const snapshot: SnapshotFile = {
      v: STORE_VERSION,
      generatedAt: 100,
      projects: [],
      chats: [{
        id: "chat-1",
        projectId: "proj-1",
        title: "Test Chat",
        createdAt: 1,
        updatedAt: 1,
        unread: false,
        provider: null,
        planMode: false,
        sourceHash: null,
        lastTurnOutcome: null,
        sessionTokensByProvider: {},
        pendingForkSessionToken: null,
      }],
    }
    const storage = makeStorage({ "/data/snapshot.json": JSON.stringify(snapshot) })
    const state = createEmptyState()
    await loadSnapshotIntoState(storage, "/data/snapshot.json", state, new Map(), async () => {})
    expect(state.chatsById.has("chat-1")).toBe(true)
    expect(state.chatsById.get("chat-1")?.unread).toBe(false)
  })

  test("sets snapshotHasLegacyMessages when messages field present", async () => {
    const snapshot: SnapshotFile = {
      v: STORE_VERSION,
      generatedAt: 100,
      projects: [],
      chats: [],
      messages: [{ chatId: "c1", entries: [] }],
    }
    const storage = makeStorage({ "/data/snapshot.json": JSON.stringify(snapshot) })
    const legacyMessages = new Map<string, TranscriptEntry[]>()
    const result = await loadSnapshotIntoState(
      storage, "/data/snapshot.json", createEmptyState(), legacyMessages, async () => {},
    )
    expect(result.snapshotHasLegacyMessages).toBe(true)
    expect(legacyMessages.has("c1")).toBe(true)
  })

  test("returns legacySidebarProjectOrder from snapshot", async () => {
    const snapshot: SnapshotFile = {
      v: STORE_VERSION,
      generatedAt: 100,
      projects: [],
      chats: [],
      sidebarProjectOrder: ["proj-2", "proj-1"],
    }
    const storage = makeStorage({ "/data/snapshot.json": JSON.stringify(snapshot) })
    const result = await loadSnapshotIntoState(
      storage, "/data/snapshot.json", createEmptyState(), new Map(), async () => {},
    )
    expect(result.legacySidebarProjectOrder).toEqual(["proj-2", "proj-1"])
  })

  test("calls clearStorage and returns empty on JSON parse error", async () => {
    const storage = makeStorage({ "/data/snapshot.json": "{ invalid json" })
    const state = createEmptyState()
    let clearCalled = false
    const result = await loadSnapshotIntoState(
      storage, "/data/snapshot.json", state, new Map(),
      async () => { clearCalled = true },
    )
    expect(clearCalled).toBe(true)
    expect(result).toEqual({ snapshotHasLegacyMessages: false, legacySidebarProjectOrder: [] })
  })

  test("migrates legacy sessionToken to sessionTokensByProvider", async () => {
    const legacyChat = {
      id: "chat-1",
      projectId: "proj-1",
      title: "T",
      createdAt: 1,
      updatedAt: 1,
      unread: false,
      provider: "claude" as const,
      sessionToken: "tok-123",
      sessionTokensByProvider: undefined,
      pendingForkSessionToken: null,
    }
    const snapshot = { v: STORE_VERSION, generatedAt: 1, projects: [], chats: [legacyChat] }
    const storage = makeStorage({ "/data/snapshot.json": JSON.stringify(snapshot) })
    const state = createEmptyState()
    await loadSnapshotIntoState(storage, "/data/snapshot.json", state, new Map(), async () => {})
    const chat = state.chatsById.get("chat-1")
    expect(chat?.sessionTokensByProvider?.claude).toBe("tok-123")
  })
})

// ---------------------------------------------------------------------------
// buildSnapshotFile
// ---------------------------------------------------------------------------
describe("buildSnapshotFile", () => {
  test("returns snapshot with correct version and empty arrays", () => {
    const state = createEmptyState()
    const result = buildSnapshotFile(state, [])
    expect(result.v).toBe(STORE_VERSION)
    expect(result.projects).toEqual([])
    expect(result.chats).toEqual([])
    expect(result.queuedMessages).toEqual([])
    expect(result.autoContinueEvents).toEqual([])
    expect(result.stacks).toEqual([])
  })

  test("includes only non-deleted chats", () => {
    const state = createEmptyState()
    state.chatsById.set("c1", {
      id: "c1", projectId: "p1", title: "A", createdAt: 1, updatedAt: 1, unread: false,
      provider: null, planMode: false, sourceHash: null, lastTurnOutcome: null,
      sessionTokensByProvider: {}, pendingForkSessionToken: null,
    })
    state.chatsById.set("c2", {
      id: "c2", projectId: "p1", title: "B", createdAt: 1, updatedAt: 1, unread: false,
      provider: null, planMode: false, sourceHash: null, lastTurnOutcome: null,
      sessionTokensByProvider: {}, pendingForkSessionToken: null,
      deletedAt: 99,
    })
    const result = buildSnapshotFile(state, [])
    expect(result.chats.map((c) => c.id)).toEqual(["c1"])
  })

  test("serializes stacks correctly", () => {
    const state = createEmptyState()
    state.stacksById.set("stack-1", {
      id: "stack-1",
      title: "My Stack",
      projectIds: ["p1", "p2"],
      createdAt: 1,
      updatedAt: 1,
    })
    const result = buildSnapshotFile(state, [])
    expect(result.stacks).toHaveLength(1)
    expect(result.stacks![0].projectIds).toEqual(["p1", "p2"])
  })
})

// ---------------------------------------------------------------------------
// truncateLogsAfterSnapshot
// ---------------------------------------------------------------------------
describe("truncateLogsAfterSnapshot", () => {
  test("writes snapshot JSON and clears all compactable log files", async () => {
    const storage = makeStorage({
      "/data/snapshot.json": "old",
      "/data/projects.jsonl": "data",
      "/data/chats.jsonl": "data",
      "/data/messages.jsonl": "data",
      "/data/queued-messages.jsonl": "data",
      "/data/turns.jsonl": "data",
      "/data/schedules.jsonl": "data",
      "/data/stacks.jsonl": "data",
      "/data/tool-requests.jsonl": "data",
    })
    await truncateLogsAfterSnapshot(storage, PATHS, '{"v":3}')
    expect(storage.written.get("/data/snapshot.json")).toBe('{"v":3}')
    expect(storage.written.get("/data/projects.jsonl")).toBe("")
    expect(storage.written.get("/data/chats.jsonl")).toBe("")
    expect(storage.written.get("/data/messages.jsonl")).toBe("")
    expect(storage.written.get("/data/tool-requests.jsonl")).toBe("")
  })
})

// ---------------------------------------------------------------------------
// calcShouldTruncateLogs
// ---------------------------------------------------------------------------
describe("calcShouldTruncateLogs", () => {
  test("returns false when combined size is below threshold", async () => {
    const storage = makeStorage(
      Object.fromEntries(Object.values(PATHS).map((p) => [p, "small"])),
    )
    const result = await calcShouldTruncateLogs(storage, PATHS)
    expect(result).toBe(false)
  })

  test("returns true when combined size meets 2 MiB threshold", async () => {
    // 2 MiB spread across files: put all in the projects log
    const bigData = "x".repeat(2 * 1024 * 1024)
    const storage = makeStorage({ "/data/projects.jsonl": bigData })
    const result = await calcShouldTruncateLogs(storage, PATHS)
    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// readSidebarOrderFromProjectsLog
// ---------------------------------------------------------------------------
describe("readSidebarOrderFromProjectsLog", () => {
  test("returns empty array if file does not exist", async () => {
    const storage = makeStorage()
    const result = await readSidebarOrderFromProjectsLog(storage, "/data/projects.jsonl")
    expect(result).toEqual([])
  })

  test("returns empty array if file is empty", async () => {
    const storage = makeStorage({ "/data/projects.jsonl": "" })
    const result = await readSidebarOrderFromProjectsLog(storage, "/data/projects.jsonl")
    expect(result).toEqual([])
  })

  test("extracts projectIds from sidebar_project_order_set events", async () => {
    const event = JSON.stringify({
      v: STORE_VERSION, type: "sidebar_project_order_set",
      timestamp: 1, projectIds: ["p2", "p1"],
    })
    const storage = makeStorage({ "/data/projects.jsonl": `${event}\n` })
    const result = await readSidebarOrderFromProjectsLog(storage, "/data/projects.jsonl")
    expect(result).toEqual(["p2", "p1"])
  })

  test("returns last seen order if multiple events present", async () => {
    const e1 = JSON.stringify({ v: STORE_VERSION, type: "sidebar_project_order_set", timestamp: 1, projectIds: ["p1"] })
    const e2 = JSON.stringify({ v: STORE_VERSION, type: "sidebar_project_order_set", timestamp: 2, projectIds: ["p2", "p1"] })
    const storage = makeStorage({ "/data/projects.jsonl": `${e1}\n${e2}\n` })
    const result = await readSidebarOrderFromProjectsLog(storage, "/data/projects.jsonl")
    expect(result).toEqual(["p2", "p1"])
  })

  test("skips non-sidebar events", async () => {
    const projectEvent = JSON.stringify({ v: STORE_VERSION, type: "project_opened", timestamp: 1, projectId: "p1", localPath: "/", title: "t" })
    const sidebarEvent = JSON.stringify({ v: STORE_VERSION, type: "sidebar_project_order_set", timestamp: 2, projectIds: ["p1"] })
    const storage = makeStorage({ "/data/projects.jsonl": `${projectEvent}\n${sidebarEvent}\n` })
    const result = await readSidebarOrderFromProjectsLog(storage, "/data/projects.jsonl")
    expect(result).toEqual(["p1"])
  })
})

// ---------------------------------------------------------------------------
// writeSidebarOrderFile
// ---------------------------------------------------------------------------
describe("writeSidebarOrderFile", () => {
  test("writes projectIds as JSON to the sidebar order file", async () => {
    const storage = makeStorage()
    await writeSidebarOrderFile(storage, "/data", "/data/sidebar-order.json", ["p1", "p2"])
    const written = storage.written.get("/data/sidebar-order.json")
    expect(written).toBeDefined()
    const parsed = JSON.parse(written!)
    expect(parsed).toEqual(["p1", "p2"])
  })
})

// ---------------------------------------------------------------------------
// loadSidebarOrder
// ---------------------------------------------------------------------------
describe("loadSidebarOrder", () => {
  test("reads from dedicated sidebar-order.json when it exists", async () => {
    const storage = makeStorage({
      "/data/sidebar-order.json": JSON.stringify(["p3", "p1", "p2"]),
    })
    const result = await loadSidebarOrder(storage, "/data/sidebar-order.json", "/data/projects.jsonl", "/data", [])
    expect(result).toEqual(["p3", "p1", "p2"])
  })

  test("returns empty array if sidebar-order.json is blank", async () => {
    const storage = makeStorage({ "/data/sidebar-order.json": "   " })
    const result = await loadSidebarOrder(storage, "/data/sidebar-order.json", "/data/projects.jsonl", "/data", [])
    expect(result).toEqual([])
  })

  test("migrates from projects.jsonl when sidebar-order.json absent", async () => {
    const sidebarEvent = JSON.stringify({
      v: STORE_VERSION, type: "sidebar_project_order_set", timestamp: 1, projectIds: ["p2", "p1"],
    })
    const storage = makeStorage({ "/data/projects.jsonl": `${sidebarEvent}\n` })
    const result = await loadSidebarOrder(storage, "/data/sidebar-order.json", "/data/projects.jsonl", "/data", [])
    expect(result).toEqual(["p2", "p1"])
    // Should have written the sidebar-order.json file as a migration
    expect(storage.written.has("/data/sidebar-order.json")).toBe(true)
  })

  test("falls back to legacySidebarProjectOrder when no file or log events", async () => {
    const storage = makeStorage()
    const result = await loadSidebarOrder(storage, "/data/sidebar-order.json", "/data/projects.jsonl", "/data", ["p4"])
    expect(result).toEqual(["p4"])
  })
})

// ---------------------------------------------------------------------------
// computeLegacyTranscriptStats
// ---------------------------------------------------------------------------
describe("computeLegacyTranscriptStats", () => {
  test("returns hasLegacyData false when nothing present", async () => {
    const storage = makeStorage({ "/data/messages.jsonl": "" })
    const result = await computeLegacyTranscriptStats(storage, "/data/messages.jsonl", false, new Map())
    expect(result.hasLegacyData).toBe(false)
    expect(result.sources).toEqual([])
  })

  test("includes snapshot source when snapshotHasLegacyMessages is true", async () => {
    const storage = makeStorage({ "/data/messages.jsonl": "" })
    const result = await computeLegacyTranscriptStats(storage, "/data/messages.jsonl", true, new Map())
    expect(result.hasLegacyData).toBe(true)
    expect(result.sources).toContain("snapshot")
  })

  test("includes messages_log source when messages.jsonl is non-empty", async () => {
    const storage = makeStorage({ "/data/messages.jsonl": "some content" })
    const result = await computeLegacyTranscriptStats(storage, "/data/messages.jsonl", false, new Map())
    expect(result.hasLegacyData).toBe(true)
    expect(result.sources).toContain("messages_log")
  })

  test("counts entries and chats from legacyMessages map", async () => {
    const storage = makeStorage({ "/data/messages.jsonl": "" })
    const legacyMessages = new Map<string, TranscriptEntry[]>([
      ["c1", [{ _id: "a", createdAt: 1, kind: "user_prompt", content: "" }]],
      ["c2", [
        { _id: "b", createdAt: 2, kind: "user_prompt", content: "" },
        { _id: "c", createdAt: 3, kind: "user_prompt", content: "" },
      ]],
    ])
    const result = await computeLegacyTranscriptStats(storage, "/data/messages.jsonl", false, legacyMessages)
    expect(result.chatCount).toBe(2)
    expect(result.entryCount).toBe(3)
    expect(result.hasLegacyData).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// migrateLegacyTranscripts
// ---------------------------------------------------------------------------
describe("migrateLegacyTranscripts", () => {
  test("returns false immediately when no legacy data", async () => {
    const storage = makeStorage()
    const stats: LegacyTranscriptStats = { hasLegacyData: false, sources: [], chatCount: 0, entryCount: 0 }
    const result = await migrateLegacyTranscripts(
      storage, "/data/transcripts", stats,
      new Map(), (_id) => `/data/transcripts/${_id}.jsonl`,
      () => {}, async () => {}, () => {},
    )
    expect(result).toBe(false)
  })

  test("writes per-chat transcript files and calls callbacks on success", async () => {
    const storage = makeStorage()
    const legacyMessages = new Map<string, TranscriptEntry[]>([
      ["chat-1", [{ _id: "e1", createdAt: 1, kind: "user_prompt", content: "hello" }]],
    ])
    const stats: LegacyTranscriptStats = {
      hasLegacyData: true,
      sources: ["snapshot"],
      chatCount: 1,
      entryCount: 1,
    }
    let clearCalled = false
    let snapshotCalled = false
    let cacheCalled = false
    const messages: string[] = []

    const result = await migrateLegacyTranscripts(
      storage,
      "/data/transcripts",
      stats,
      legacyMessages,
      (id) => `/data/transcripts/${id}.jsonl`,
      () => { clearCalled = true },
      async () => { snapshotCalled = true },
      () => { cacheCalled = true },
      (msg) => messages.push(msg),
    )

    expect(result).toBe(true)
    expect(clearCalled).toBe(true)
    expect(snapshotCalled).toBe(true)
    expect(cacheCalled).toBe(true)

    // The renamed file (tmp→final) should exist
    expect(storage.renamed).toHaveLength(1)
    expect(storage.renamed[0][1]).toBe("/data/transcripts/chat-1.jsonl")
    expect(messages.some((m) => m.includes("migration complete"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// loadAndReplayLogs
// ---------------------------------------------------------------------------
describe("loadAndReplayLogs", () => {
  test("exits early when storageReset is true before loading", async () => {
    const storage = makeStorage()
    let applied = 0
    await loadAndReplayLogs(
      storage, PATHS,
      () => true,
      () => { applied++ },
      async () => {},
      () => {},
    )
    expect(applied).toBe(0)
  })

  test("applies events from multiple log files in timestamp order", async () => {
    const e1 = JSON.stringify({ v: STORE_VERSION, type: "project_opened", timestamp: 200, projectId: "p1", localPath: "/", title: "T" })
    const e2 = JSON.stringify({ v: STORE_VERSION, type: "project_opened", timestamp: 100, projectId: "p2", localPath: "/2", title: "T2" })
    const storage = makeStorage({
      "/data/projects.jsonl": `${e1}\n`,
      "/data/stacks.jsonl": `${e2}\n`,
    })

    const applied: StoreEvent[] = []
    await loadAndReplayLogs(
      storage, PATHS,
      () => false,
      (event) => { applied.push(event) },
      async () => {},
      () => {},
    )

    // Should be sorted by timestamp: p2 (100) before p1 (200)
    expect(applied).toHaveLength(2)
    const first = applied[0] as Extract<typeof applied[0], { type: "project_opened" }>
    expect(first.type).toBe("project_opened")
    expect((first as { projectId?: string }).projectId).toBe("p2")
  })

  test("calls clearStorage and exits on version mismatch in a log file", async () => {
    const badEvent = JSON.stringify({ v: 999, type: "project_opened", timestamp: 1 })
    const storage = makeStorage({ "/data/projects.jsonl": `${badEvent}\n` })
    let clearCalled = false
    let storageReset = false
    await loadAndReplayLogs(
      storage, PATHS,
      () => storageReset,
      () => {},
      async () => { clearCalled = true; storageReset = true },
      () => {},
    )
    expect(clearCalled).toBe(true)
  })

  test("calls onReplayChatProviderClear after successful replay", async () => {
    const storage = makeStorage()
    let cleared = false
    await loadAndReplayLogs(
      storage, PATHS,
      () => false,
      () => {},
      async () => {},
      () => { cleared = true },
    )
    expect(cleared).toBe(true)
  })
})
