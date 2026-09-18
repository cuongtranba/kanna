import { expect, test } from "bun:test"
import { deriveChatTasks } from "../shared/chat-tasks/read-model"
import { CHAT_TASK_EVENT_VERSION, type ChatTaskEvent } from "../shared/chat-tasks/types"
import { normalizeToolCall } from "../shared/tools"
import type { TranscriptEntry } from "../shared/types"
import { applyChatTaskEvent, mirrorTranscriptEntry, type PendingNativeTaskCalls } from "./event-store-tasks"
import { buildSnapshotFile, loadSnapshotIntoState } from "./event-store-snapshot"
import { createEmptyState } from "./events"

const CHAT = "chat-1"

function harness(seed: readonly ChatTaskEvent[] = []) {
  const chatTasksByChatId = new Map<string, ChatTaskEvent[]>()
  const pending: PendingNativeTaskCalls = new Map()
  for (const event of seed) applyChatTaskEvent(chatTasksByChatId, event)

  const feed = (entry: TranscriptEntry, now = 100): void => {
    for (const event of mirrorTranscriptEntry({ pending, chatTasksByChatId, chatId: CHAT, entry, now })) {
      applyChatTaskEvent(chatTasksByChatId, event)
    }
  }
  const project = (now = 100) => deriveChatTasks(chatTasksByChatId.get(CHAT) ?? [], { now })
  return { feed, project, chatTasksByChatId }
}

function toolCall(toolId: string, toolName: string, input: Record<string, string>): TranscriptEntry {
  return {
    _id: `call-${toolId}`,
    createdAt: 1,
    kind: "tool_call",
    tool: normalizeToolCall({ toolName, toolId, input }),
  }
}

function toolResult(toolId: string, structured: string, isError = false): TranscriptEntry {
  return {
    _id: `res-${toolId}`,
    createdAt: 2,
    kind: "tool_result",
    toolId,
    content: "ok",
    ...(isError ? { isError: true } : {}),
    debugRaw: JSON.stringify({ tool_use_result: JSON.parse(structured) }),
  }
}

const kannaTask: ChatTaskEvent = {
  v: CHAT_TASK_EVENT_VERSION,
  timestamp: 1,
  chatId: CHAT,
  type: "chat_task_created",
  taskId: "k:plan",
  subject: "Migrate the callers",
  source: "kanna",
}

test("a Kanna-owned task survives context_cleared — the loop's whole durability promise", () => {
  const h = harness([kannaTask])

  h.feed({ _id: "c1", createdAt: 5, kind: "context_cleared" })

  const projection = h.project()
  expect(projection.tasks.map((t) => t.id)).toEqual(["k:plan"])
  expect(projection.staleTaskIds.has("k:plan")).toBe(false)
})

test("a native task goes stale after context_cleared instead of vanishing", () => {
  const h = harness()
  h.feed(toolCall("t1", "TaskCreate", { subject: "Scratch note" }))
  h.feed(toolResult("t1", JSON.stringify({ task: { id: "7", subject: "Scratch note" } })))
  expect(h.project().staleTaskIds.has("n:7")).toBe(false)

  h.feed({ _id: "c1", createdAt: 5, kind: "context_cleared" })

  const projection = h.project()
  expect(projection.tasks.map((t) => t.id)).toEqual(["n:7"])
  expect(projection.staleTaskIds.has("n:7")).toBe(true)
})

test("a native TaskList resync replaces only the native namespace and leaves loop tasks alone", () => {
  const h = harness([kannaTask])
  h.feed(toolCall("t1", "TaskCreate", { subject: "Old native" }))
  h.feed(toolResult("t1", JSON.stringify({ task: { id: "1", subject: "Old native" } })))

  h.feed(toolCall("t2", "TaskList", {}))
  h.feed(toolResult("t2", JSON.stringify({ tasks: [{ id: "9", subject: "Fresh native", status: "in_progress" }] })))

  const ids = h.project().tasks.map((t) => t.id)
  expect(ids).toContain("k:plan")
  expect(ids).toContain("n:9")
  expect(ids).not.toContain("n:1")
})

test("an empty TaskList result changes nothing", () => {
  const h = harness([kannaTask])
  h.feed(toolCall("t1", "TaskList", {}))
  h.feed(toolResult("t1", JSON.stringify({ tasks: [] })))

  expect(h.project().tasks.map((t) => t.id)).toEqual(["k:plan"])
})

test("a native TaskUpdate for an id Kanna never saw repairs itself instead of dropping the task", () => {
  const h = harness()
  h.feed(toolCall("t1", "TaskUpdate", { taskId: "4", subject: "Adopted", status: "completed" }))
  h.feed(toolResult("t1", JSON.stringify({ success: true, taskId: "4" })))

  const task = h.project().tasks[0]
  expect(task?.id).toBe("n:4")
  expect(task?.status).toBe("completed")
})

test("a failed native tool result is not mirrored", () => {
  const h = harness()
  h.feed(toolCall("t1", "TaskCreate", { subject: "Never created" }))
  h.feed(toolResult("t1", JSON.stringify({ task: { id: "3", subject: "Never created" } }), true))

  expect(h.project().tasks).toHaveLength(0)
})

test("a tool_result with no matching tool_call is ignored", () => {
  const h = harness([kannaTask])
  h.feed(toolResult("orphan", JSON.stringify({ task: { id: "5", subject: "Ghost" } })))

  expect(h.project().tasks.map((t) => t.id)).toEqual(["k:plan"])
})

test("tasks survive a snapshot round trip — the server-restart promise", async () => {
  const source = createEmptyState()
  applyChatTaskEvent(source.chatTasksByChatId, kannaTask)
  applyChatTaskEvent(source.chatTasksByChatId, {
    v: CHAT_TASK_EVENT_VERSION, timestamp: 2, chatId: CHAT,
    type: "chat_task_claimed", taskId: "k:plan", claimId: "c1",
  })

  const snapshotJson = JSON.stringify(buildSnapshotFile(source, []))
  const files = new Map<string, string>([["/data/snapshot.json", snapshotJson]])
  const storage = {
    readText: async (p: string) => files.get(p) ?? "",
    writeText: async (p: string, c: string) => { files.set(p, c) },
    appendText: async (p: string, c: string) => { files.set(p, (files.get(p) ?? "") + c) },
    exists: async (p: string) => files.has(p),
    rename: async () => {},
    remove: async (p: string) => { files.delete(p) },
    mkdir: async () => {},
    existsSync: (p: string) => files.has(p),
    size: async (p: string) => (files.get(p) ?? "").length,
    readTextSync: (p: string) => files.get(p) ?? "",
  }

  const restored = createEmptyState()
  await loadSnapshotIntoState(storage, "/data/snapshot.json", restored, new Map(), async () => {})

  const projection = deriveChatTasks(restored.chatTasksByChatId.get(CHAT) ?? [], { now: 100 })
  expect(projection.tasks[0]?.id).toBe("k:plan")
  expect(projection.tasks[0]?.status).toBe("in_progress")
  expect(projection.tasks[0]?.claimId).toBe("c1")
})
