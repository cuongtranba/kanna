import { describe, expect, test } from "vite-plus/test"
import type { ToolRequest } from "../shared/permission-policy"
import type { ChatTaskEvent } from "../shared/chat-tasks/types"
import { EventStore, type TurnTerminalListener } from "./event-store"
import { storeLayoutFor } from "./event-logs"
import { InMemoryStorageBackend } from "./storage/in-memory-storage"

const DATA_DIR = "/virtual-write-protocol"
const STALE_EMPTY_CHAT_MAX_AGE_MS = 30 * 60 * 1000

async function bootStore(storage: InMemoryStorageBackend): Promise<EventStore> {
  const store = new EventStore(DATA_DIR, storage)
  await store.initialize()
  return store
}

function taskCreated(chatId: string, taskId: string): ChatTaskEvent {
  return { v: 3, type: "chat_task_created", timestamp: 1, chatId, taskId, subject: taskId, source: "kanna" }
}

function toolRequest(chatId: string, id: string): ToolRequest {
  return {
    id,
    chatId,
    sessionId: "session-1",
    toolUseId: `use-${id}`,
    toolName: "Bash",
    arguments: { command: "ls" },
    canonicalArgsHash: "hash",
    policyVerdict: "ask",
    status: "pending",
    createdAt: 1,
    expiresAt: 2,
  }
}

describe("turn terminal listeners", () => {
  test("every subscribed listener hears each terminal outcome, and a failure carries its error", async () => {
    const store = await bootStore(new InMemoryStorageBackend())
    const project = await store.openProject("/tmp/p")
    const chat = await store.createChat(project.id)
    const first: string[] = []
    const second: string[] = []
    store.subscribeTurnTerminal((chatId, outcome, error) => { first.push(`${chatId}:${outcome}:${error ?? ""}`) })
    store.subscribeTurnTerminal((_chatId, outcome) => { second.push(outcome) })

    await store.recordTurnStarted(chat.id)
    await store.recordTurnFinished(chat.id)
    await store.recordTurnStarted(chat.id)
    await store.recordTurnFailed(chat.id, "boom")
    await store.recordTurnStarted(chat.id)
    await store.recordTurnCancelled(chat.id)

    expect(first).toEqual([`${chat.id}:finished:`, `${chat.id}:failed:boom`, `${chat.id}:cancelled:`])
    expect(second).toEqual(["finished", "failed", "cancelled"])
  })

  test("an unsubscribed listener hears nothing and the others are unaffected", async () => {
    const store = await bootStore(new InMemoryStorageBackend())
    const project = await store.openProject("/tmp/p")
    const chat = await store.createChat(project.id)
    const kept: string[] = []
    const dropped: string[] = []
    const keptListener: TurnTerminalListener = (_chatId, outcome) => { kept.push(outcome) }
    store.subscribeTurnTerminal(keptListener)
    const unsubscribe = store.subscribeTurnTerminal((_chatId, outcome) => { dropped.push(outcome) })
    unsubscribe()

    await store.recordTurnStarted(chat.id)
    await store.recordTurnFinished(chat.id)

    expect(kept).toEqual(["finished"])
    expect(dropped).toEqual([])
  })
})

describe("decideChatTaskEvents", () => {
  test("persists the decided events and returns the decision's result", async () => {
    const storage = new InMemoryStorageBackend()
    const store = await bootStore(storage)

    const decision = await store.decideChatTaskEvents("chat-1", { now: 1 }, () => ({
      events: [taskCreated("chat-1", "k:one")],
      result: "decided",
    }))

    expect(decision.result).toBe("decided")
    expect(decision.events).toHaveLength(1)
    expect(store.getChatTaskEvents("chat-1")).toHaveLength(1)
    const logged = await storage.readText(storeLayoutFor(DATA_DIR).logPath("chat-tasks"))
    expect(logged.trim().split("\n")).toHaveLength(1)
  })

  test("concurrent decisions each see the events the earlier one committed", async () => {
    const store = await bootStore(new InMemoryStorageBackend())
    const seen: number[] = []

    await Promise.all(["k:a", "k:b", "k:c"].map((taskId) =>
      store.decideChatTaskEvents("chat-1", { now: 1 }, (projection) => {
        seen.push(projection.tasks.length)
        return { events: [taskCreated("chat-1", taskId)], result: null }
      }),
    ))

    expect(seen).toEqual([0, 1, 2])
  })
})

describe("pruneStaleEmptyChats", () => {
  test("drops the pruned chat's pending tool requests, as deleteChat does", async () => {
    const store = await bootStore(new InMemoryStorageBackend())
    const project = await store.openProject("/tmp/p")
    const chat = await store.createChat(project.id)
    await store.putToolRequest(toolRequest(chat.id, "req-1"))

    const pruned = await store.pruneStaleEmptyChats({ now: chat.createdAt + STALE_EMPTY_CHAT_MAX_AGE_MS })

    expect(pruned).toEqual([chat.id])
    expect(store.getToolRequest("req-1")).toBeNull()
    expect(store.listPendingToolRequests(chat.id)).toEqual([])
  })
})

describe("storage reset", () => {
  async function bootWithSnapshottedTask(storage: InMemoryStorageBackend) {
    const store = await bootStore(storage)
    const project = await store.openProject("/tmp/p")
    const chat = await store.createChat(project.id)
    await store.appendChatTaskEvents([taskCreated(chat.id, "k:one")])
    await store.appendPushEvent({ kind: "project_mute_set", ts: 1, localPath: "/tmp/p", muted: true })
    await store.snapshotAndTruncateLogs()
    return { chat }
  }

  test("a corrupt log after a good snapshot also forgets the snapshot's chat tasks", async () => {
    const storage = new InMemoryStorageBackend()
    const { chat } = await bootWithSnapshottedTask(storage)
    await storage.writeText(storeLayoutFor(DATA_DIR).logPath("chats"), 'garbage\n{"v":3}\n')

    const restarted = await bootStore(storage)

    expect(restarted.listProjects()).toEqual([])
    expect(restarted.getChatTaskEvents(chat.id)).toEqual([])
    expect(restarted.getSubagentRuns(chat.id)).toEqual({})
  })

  test("the push log is not emptied by a reset", async () => {
    const storage = new InMemoryStorageBackend()
    await bootWithSnapshottedTask(storage)
    await storage.writeText(storeLayoutFor(DATA_DIR).logPath("chats"), 'garbage\n{"v":3}\n')

    await bootStore(storage)

    expect(await storage.readText(storeLayoutFor(DATA_DIR).logPath("push"))).toContain("/tmp/p")
  })
})
