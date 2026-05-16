import { afterEach, describe, expect, test } from "bun:test"
import type { ToolRequest } from "../shared/permission-policy"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { TranscriptEntry } from "../shared/types"
import type { SnapshotFile } from "./events"
import type { AutoContinueEvent } from "./auto-continue/events"
import { EventStore } from "./event-store"
import { ACTIVE_SESSION_IDLE_GAP_MS } from "./read-models"

const originalRuntimeProfile = process.env.KANNA_RUNTIME_PROFILE
const tempDirs: string[] = []

afterEach(async () => {
  if (originalRuntimeProfile === undefined) {
    delete process.env.KANNA_RUNTIME_PROFILE
  } else {
    process.env.KANNA_RUNTIME_PROFILE = originalRuntimeProfile
  }

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDataDir() {
  const dir = await mkdtemp(join(tmpdir(), "kanna-event-store-"))
  tempDirs.push(dir)
  return dir
}

function entry(kind: "user_prompt" | "assistant_text", createdAt: number, extra: Record<string, unknown> = {}): TranscriptEntry {
  const base = { _id: `${kind}-${createdAt}`, createdAt }
  if (kind === "user_prompt") {
    return { ...base, kind, content: String(extra.content ?? "") }
  }
  return { ...base, kind, text: String(extra.content ?? extra.text ?? "") }
}

describe("EventStore", () => {
  test("uses the runtime profile for the default data dir", () => {
    process.env.KANNA_RUNTIME_PROFILE = "dev"

    const store = new EventStore()

    expect(store.dataDir).toEndWith("/.kanna-dev/data")
  })

  test("migrates legacy snapshot and messages log transcripts into per-chat files", async () => {
    const dataDir = await createTempDataDir()
    const snapshotPath = join(dataDir, "snapshot.json")
    const messagesLogPath = join(dataDir, "messages.jsonl")
    const chatId = "chat-1"

    const snapshot = {
      v: 3,
      generatedAt: 10,
      projects: [{
        id: "project-1",
        localPath: "/tmp/project",
        title: "Project",
        createdAt: 1,
        updatedAt: 5,
      }],
      chats: [{
        id: chatId,
        projectId: "project-1",
        title: "Chat",
        createdAt: 1,
        updatedAt: 5,
        unread: false,
        provider: null,
        planMode: false,
        sessionToken: null,
        sourceHash: null,
        lastTurnOutcome: null,
      }],
      messages: [{
        chatId,
        entries: [
          entry("user_prompt", 100, { content: "hello" }),
        ],
      }],
    } as unknown as SnapshotFile

    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8")
    await writeFile(messagesLogPath, `${JSON.stringify({
      v: 3,
      type: "message_appended",
      timestamp: 101,
      chatId,
      entry: entry("assistant_text", 101, { content: "world" }),
    })}\n`, "utf8")

    const store = new EventStore(dataDir)
    await store.initialize()

    const progress: string[] = []
    const migrated = await store.migrateLegacyTranscripts((message) => {
      progress.push(message)
    })

    expect(migrated).toBe(true)
    expect(progress.some((message) => message.includes("transcript migration detected"))).toBe(true)
    expect(progress.at(-1)).toContain("transcript migration complete")
    expect(store.getMessages(chatId)).toEqual([
      entry("user_prompt", 100, { content: "hello" }),
      entry("assistant_text", 101, { text: "world" }),
    ])

    const migratedSnapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as SnapshotFile
    expect(migratedSnapshot.messages).toBeUndefined()
    expect(await readFile(messagesLogPath, "utf8")).toBe("")
    expect(await readFile(join(dataDir, "transcripts", `${chatId}.jsonl`), "utf8")).toContain('"kind":"assistant_text"')
  })

  test("appends new transcript entries only to the per-chat transcript file", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)
    await store.appendMessage(chat.id, entry("user_prompt", 200, { content: "hello" }))
    await store.appendMessage(chat.id, entry("assistant_text", 201, { content: "world" }))
    await store.snapshotAndTruncateLogs()

    expect(store.getMessages(chat.id)).toEqual([
      entry("user_prompt", 200, { content: "hello" }),
      entry("assistant_text", 201, { text: "world" }),
    ])
    expect(await readFile(join(dataDir, "messages.jsonl"), "utf8")).toBe("")

    const snapshot = JSON.parse(await readFile(join(dataDir, "snapshot.json"), "utf8")) as SnapshotFile
    expect(snapshot.messages).toBeUndefined()
    expect(existsSync(join(dataDir, "transcripts", `${chat.id}.jsonl`))).toBe(true)
  })

  test("pages recent transcript history and older entries by cursor", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    for (let index = 1; index <= 5; index += 1) {
      await store.appendMessage(chat.id, entry(index % 2 === 0 ? "assistant_text" : "user_prompt", 200 + index, {
        content: `message-${index}`,
      }))
    }

    const recentPage = store.getRecentMessagesPage(chat.id, 2)
    expect(recentPage.messages.map((message) => message._id)).toEqual(["assistant_text-204", "user_prompt-205"])
    expect(recentPage.hasOlder).toBe(true)
    expect(recentPage.olderCursor).not.toBeNull()

    const olderPage = store.getMessagesPageBefore(chat.id, recentPage.olderCursor!, 2)
    expect(olderPage.messages.map((message) => message._id)).toEqual(["assistant_text-202", "user_prompt-203"])
    expect(olderPage.hasOlder).toBe(true)
    expect(olderPage.olderCursor).not.toBeNull()

    const oldestPage = store.getMessagesPageBefore(chat.id, olderPage.olderCursor!, 2)
    expect(oldestPage.messages.map((message) => message._id)).toEqual(["user_prompt-201"])
    expect(oldestPage.hasOlder).toBe(false)
    expect(oldestPage.olderCursor).toBeNull()
  })

  test("persists queued messages across restart and removes promoted entries", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    const first = await store.enqueueMessage(chat.id, {
      content: "first queued",
      attachments: [],
      provider: "codex",
      model: "gpt-5.4",
      planMode: false,
    })
    const second = await store.enqueueMessage(chat.id, {
      content: "second queued",
      attachments: [],
      provider: "claude",
      model: "claude-sonnet-4-6",
      planMode: true,
    })

    expect(store.getQueuedMessages(chat.id).map((message) => message.content)).toEqual([
      "first queued",
      "second queued",
    ])

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()
    expect(reloaded.getQueuedMessages(chat.id).map((message) => message.content)).toEqual([
      "first queued",
      "second queued",
    ])

    await reloaded.removeQueuedMessage(chat.id, first.id)
    expect(reloaded.getQueuedMessages(chat.id).map((message) => message.id)).toEqual([second.id])
  })

  test("marks chats unread on completed turns and clears unread when marked read", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    expect(store.getChat(chat.id)?.unread).toBe(false)

    await store.recordTurnFinished(chat.id)
    expect(store.getChat(chat.id)?.unread).toBe(true)

    await store.setChatReadState(chat.id, false)
    expect(store.getChat(chat.id)?.unread).toBe(false)

    await store.recordTurnFailed(chat.id, "boom")
    expect(store.getChat(chat.id)?.unread).toBe(true)

    await store.recordTurnCancelled(chat.id)
    expect(store.getChat(chat.id)?.unread).toBe(true)

    await store.snapshotAndTruncateLogs()

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()
    expect(reloaded.getChat(chat.id)?.unread).toBe(true)
  })

  test("preserves read state after a finished turn across restart", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    await store.recordTurnFinished(chat.id)
    await store.setChatReadState(chat.id, false)

    expect(store.getChat(chat.id)?.unread).toBe(false)

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()

    expect(reloaded.getChat(chat.id)?.unread).toBe(false)
  })

  test("preserves read state after a failed turn across restart", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    await store.recordTurnFailed(chat.id, "boom")
    await store.setChatReadState(chat.id, false)

    expect(store.getChat(chat.id)?.unread).toBe(false)

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()

    expect(reloaded.getChat(chat.id)?.unread).toBe(false)
  })

  test("prefers mark-read over turn completion when replay timestamps tie", async () => {
    const dataDir = await createTempDataDir()
    const chatsLogPath = join(dataDir, "chats.jsonl")
    const turnsLogPath = join(dataDir, "turns.jsonl")
    const projectId = "project-1"
    const chatId = "chat-1"
    const timestamp = 100

    await writeFile(chatsLogPath, [
      JSON.stringify({
        v: 3,
        type: "chat_created",
        timestamp,
        chatId,
        projectId,
        title: "Chat",
      }),
      JSON.stringify({
        v: 3,
        type: "chat_read_state_set",
        timestamp,
        chatId,
        unread: false,
      }),
      "",
    ].join("\n"), "utf8")
    await writeFile(turnsLogPath, [
      JSON.stringify({
        v: 3,
        type: "turn_finished",
        timestamp,
        chatId,
      }),
      "",
    ].join("\n"), "utf8")

    const store = new EventStore(dataDir)
    await store.initialize()

    expect(store.getChat(chatId)?.unread).toBe(false)
  })

  test("loads chats without unread from older snapshots as read", async () => {
    const dataDir = await createTempDataDir()
    const snapshotPath = join(dataDir, "snapshot.json")

    const snapshot = {
      v: 3,
      generatedAt: 10,
      projects: [{
        id: "project-1",
        localPath: "/tmp/project",
        title: "Project",
        createdAt: 1,
        updatedAt: 5,
      }],
      chats: [{
        id: "chat-1",
        projectId: "project-1",
        title: "Chat",
        createdAt: 1,
        updatedAt: 5,
        unread: false,
        provider: null,
        planMode: false,
        sessionToken: null,
        sourceHash: null,
        lastTurnOutcome: null,
      }],
    } as unknown as SnapshotFile

    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8")

    const store = new EventStore(dataDir)
    await store.initialize()

    expect(store.getChat("chat-1")?.unread).toBe(false)
  })

  test("persists sidebar project order across restart and compaction", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const first = await store.openProject("/tmp/project-a")
    const second = await store.openProject("/tmp/project-b")

    await store.setSidebarProjectOrder([second.id, first.id])
    expect(store.getSidebarProjectOrder()).toEqual([second.id, first.id])
    expect(JSON.parse(await readFile(join(dataDir, "sidebar-order.json"), "utf8"))).toEqual([second.id, first.id])

    await store.snapshotAndTruncateLogs()

    const snapshot = JSON.parse(await readFile(join(dataDir, "snapshot.json"), "utf8")) as SnapshotFile
    expect(snapshot.sidebarProjectOrder).toBeUndefined()

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()
    expect(reloaded.getSidebarProjectOrder()).toEqual([second.id, first.id])
  })

  test("migrates legacy sidebar project order from existing snapshots and project logs", async () => {
    const dataDir = await createTempDataDir()
    const snapshotPath = join(dataDir, "snapshot.json")
    const projectsLogPath = join(dataDir, "projects.jsonl")

    const snapshot = {
      v: 3,
      generatedAt: 10,
      projects: [
        {
          id: "project-1",
          localPath: "/tmp/project-a",
          title: "Project A",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "project-2",
          localPath: "/tmp/project-b",
          title: "Project B",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      chats: [],
      sidebarProjectOrder: ["project-1"],
    }

    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8")
    await writeFile(projectsLogPath, [
      JSON.stringify({
        v: 3,
        type: "sidebar_project_order_set",
        timestamp: 20,
        projectIds: ["project-2", "project-1"],
      }),
      "",
    ].join("\n"), "utf8")

    const store = new EventStore(dataDir)
    await store.initialize()

    expect(store.getSidebarProjectOrder()).toEqual(["project-2", "project-1"])
    expect(JSON.parse(await readFile(join(dataDir, "sidebar-order.json"), "utf8"))).toEqual(["project-2", "project-1"])
  })

  test("ignores an invalid sidebar order file without resetting store state", async () => {
    const dataDir = await createTempDataDir()
    await writeFile(join(dataDir, "sidebar-order.json"), "{not-json", "utf8")

    const originalWarn = console.warn
    console.warn = () => {}
    try {
      const store = new EventStore(dataDir)
      await store.initialize()

      const project = await store.openProject("/tmp/project")

      const reloaded = new EventStore(dataDir)
      await reloaded.initialize()

      expect(reloaded.getProject(project.id)?.localPath).toBe("/tmp/project")
      expect(reloaded.getSidebarProjectOrder()).toEqual([])
    } finally {
      console.warn = originalWarn
    }
  })

  test("prunes stale empty chats after thirty minutes", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)
    const staleNow = chat.createdAt + 30 * 60 * 1000

    const pruned = await store.pruneStaleEmptyChats({ now: staleNow })

    expect(pruned).toEqual([chat.id])
    expect(store.getChat(chat.id)).toBeNull()
  })

  test("does not prune recent empty chats", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)
    const pruned = await store.pruneStaleEmptyChats({ now: chat.createdAt + 30 * 60 * 1000 - 1 })

    expect(pruned).toEqual([])
    expect(store.getChat(chat.id)?.id).toBe(chat.id)
  })

  test("does not prune chats once they have transcript messages", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)
    await store.appendMessage(chat.id, entry("user_prompt", chat.createdAt + 1, { content: "hello" }))

    const pruned = await store.pruneStaleEmptyChats({ now: chat.createdAt + 30 * 60 * 1000 })

    expect(pruned).toEqual([])
    expect(store.getChat(chat.id)?.id).toBe(chat.id)
  })

  test("does not prune stale chats that are currently active", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    const pruned = await store.pruneStaleEmptyChats({
      now: chat.createdAt + 30 * 60 * 1000,
      activeChatIds: [chat.id],
    })

    expect(pruned).toEqual([])
    expect(store.getChat(chat.id)?.id).toBe(chat.id)
  })

  test("does not prune stale chats with protected draft state", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    const pruned = await store.pruneStaleEmptyChats({
      now: chat.createdAt + 30 * 60 * 1000,
      protectedChatIds: [chat.id],
    })

    expect(pruned).toEqual([])
    expect(store.getChat(chat.id)?.id).toBe(chat.id)
  })

  test("forks a chat with copied transcript and pending fork session token", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const source = await store.createChat(project.id)
    await store.setChatProvider(source.id, "claude")
    await store.setPlanMode(source.id, true)
    await store.setSessionTokenForProvider(source.id, "claude", "session-1")
    await store.appendMessage(source.id, entry("user_prompt", source.createdAt + 1, { content: "analyze this" }))
    await store.appendMessage(source.id, entry("assistant_text", source.createdAt + 2, { text: "done" }))

    const forked = await store.forkChat(source.id)

    expect(forked.id).not.toBe(source.id)
    expect(forked.title).toBe("Fork: New Chat")
    expect(forked.provider).toBe("claude")
    expect(forked.planMode).toBe(true)
    expect(forked.sessionTokensByProvider).toEqual({})
    expect(forked.pendingForkSessionToken).toEqual({ provider: "claude", token: "session-1" })
    expect(forked.lastTurnOutcome).toBeNull()
    expect(forked.lastMessageAt).toBeUndefined()
    expect(store.getMessages(forked.id)).toEqual(store.getMessages(source.id))
  })

  test("forking a stack chat preserves stack membership", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const primary = await store.openProject("/tmp/primary")
    const secondary = await store.openProject("/tmp/secondary")
    const stack = await store.createStack("My Stack", [primary.id, secondary.id])
    const bindings = [
      { projectId: primary.id, role: "primary" as const, worktreePath: "/tmp/primary" },
      { projectId: secondary.id, role: "additional" as const, worktreePath: "/tmp/secondary" },
    ]
    const source = await store.createChat(primary.id, { stackId: stack.id, stackBindings: bindings })
    await store.setChatProvider(source.id, "claude")
    await store.setSessionTokenForProvider(source.id, "claude", "session-stack")

    const forked = await store.forkChat(source.id)

    expect(forked.stackId).toBe(stack.id)
    expect(forked.stackBindings).toEqual(bindings)
    expect(forked.projectId).toBe(primary.id)
  })

  test("reopening a removed project restores its existing chats", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    await store.removeProject(project.id)
    expect(store.getProject(project.id)).toBeNull()

    const reopened = await store.openProject("/tmp/project")

    expect(reopened.id).toBe(project.id)
    expect(store.listChatsByProject(reopened.id).map((entry) => entry.id)).toEqual([chat.id])
  })

  test("archives chats without deleting their transcript", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)
    await store.appendMessage(chat.id, entry("user_prompt", chat.createdAt + 1, { content: "keep this" }))

    await store.archiveChat(chat.id)

    expect(store.getChat(chat.id)?.archivedAt).toBeNumber()
    expect(store.listChatsByProject(project.id)).toEqual([])
    expect(store.getMessages(chat.id).map((message) => message.kind)).toEqual(["user_prompt"])

    await store.unarchiveChat(chat.id)

    expect(store.getChat(chat.id)?.archivedAt).toBeUndefined()
    expect(store.listChatsByProject(project.id).map((entry) => entry.id)).toEqual([chat.id])
  })
})

describe("recordSessionCommandsLoaded", () => {
  test("stores latest commands on chat record", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    await store.recordSessionCommandsLoaded(chat.id, [
      { name: "review", description: "Review PR", argumentHint: "<pr>" },
    ])

    expect(store.getChat(chat.id)?.slashCommands).toEqual([
      { name: "review", description: "Review PR", argumentHint: "<pr>" },
    ])
  })

  test("replaces commands on subsequent load", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    await store.recordSessionCommandsLoaded(chat.id, [
      { name: "a", description: "", argumentHint: "" },
    ])
    await store.recordSessionCommandsLoaded(chat.id, [
      { name: "b", description: "", argumentHint: "" },
    ])

    expect(store.getChat(chat.id)?.slashCommands).toEqual([
      { name: "b", description: "", argumentHint: "" },
    ])
  })

  test("skips redundant writes when commands are unchanged", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)
    const turnsLogPath = join(dataDir, "turns.jsonl")

    const commands = [{ name: "review", description: "Review", argumentHint: "<pr>" }]
    await store.recordSessionCommandsLoaded(chat.id, commands)
    const afterFirst = (await readFile(turnsLogPath, "utf8")).trim().split("\n").length

    await store.recordSessionCommandsLoaded(chat.id, [...commands.map((c) => ({ ...c }))])
    const afterSecond = (await readFile(turnsLogPath, "utf8")).trim().split("\n").length

    expect(afterSecond).toBe(afterFirst)
  })

  test("compaction + reload preserves slashCommands on chat records", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    const commands = [
      { name: "review", description: "Review PR", argumentHint: "<pr>" },
      { name: "help", description: "Show help", argumentHint: "" },
    ]
    await store.recordSessionCommandsLoaded(chat.id, commands)
    await store.snapshotAndTruncateLogs()

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()

    expect(reloaded.getChat(chat.id)?.slashCommands).toEqual(commands)
  })
})

async function setupStoreWithChat() {
  const dir = await createTempDataDir()
  const store = new EventStore(dir)
  await store.initialize()
  const project = await store.openProject("/tmp/p-setup")
  const chat = await store.createChat(project.id)
  const baseTs = chat.createdAt + 1
  return { dir, store, chatId: chat.id, baseTs }
}

describe("EventStore subagent runs", () => {
  test("subagent_run_* events build subagentRuns map and survive replay", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/p-sa")
    const chat = await store.createChat(project.id)
    const runId = "r1"
    const base = chat.createdAt + 1

    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_run_started",
      timestamp: base,
      chatId: chat.id,
      runId,
      subagentId: "s1",
      subagentName: "alpha",
      provider: "claude",
      model: "claude-opus-4-7",
      parentUserMessageId: "u1",
      parentRunId: null,
      depth: 0,
    })
    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_message_delta",
      timestamp: base + 1,
      chatId: chat.id,
      runId,
      content: "hello ",
    })
    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_run_completed",
      timestamp: base + 2,
      chatId: chat.id,
      runId,
      finalContent: "hello world",
    })

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()
    const runs = reloaded.getSubagentRuns(chat.id)
    expect(runs[runId].status).toBe("completed")
    expect(runs[runId].finalText).toBe("hello world")
  })

  test("subagent_message_delta accumulates into finalText; run_completed sets canonical", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/p-sa-stream")
    const chat = await store.createChat(project.id)
    const runId = "r-stream"
    const base = chat.createdAt + 1

    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_run_started",
      timestamp: base,
      chatId: chat.id,
      runId,
      subagentId: "s1",
      subagentName: "alpha",
      provider: "claude",
      model: "claude-opus-4-7",
      parentUserMessageId: "u1",
      parentRunId: null,
      depth: 0,
    })
    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_message_delta",
      timestamp: base + 1,
      chatId: chat.id,
      runId,
      content: "Hello ",
    })
    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_message_delta",
      timestamp: base + 2,
      chatId: chat.id,
      runId,
      content: "world",
    })

    const mid = store.getSubagentRuns(chat.id)[runId]
    expect(mid.status).toBe("running")
    expect(mid.finalText).toBe("Hello world")

    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_run_completed",
      timestamp: base + 3,
      chatId: chat.id,
      runId,
      finalContent: "Hello world!",
    })

    const done = store.getSubagentRuns(chat.id)[runId]
    expect(done.status).toBe("completed")
    expect(done.finalText).toBe("Hello world!")

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()
    expect(reloaded.getSubagentRuns(chat.id)[runId].finalText).toBe("Hello world!")
  })

  test("chat_deleted drops subagent runs; recreating chatId does not resurrect them", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/p-sa-del")
    const chat = await store.createChat(project.id)
    const runId = "r-deleted"
    const base = chat.createdAt + 1

    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_run_started",
      timestamp: base,
      chatId: chat.id,
      runId,
      subagentId: "s1",
      subagentName: "alpha",
      provider: "claude",
      model: "claude-opus-4-7",
      parentUserMessageId: "u1",
      parentRunId: null,
      depth: 0,
    })
    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_run_completed",
      timestamp: base + 1,
      chatId: chat.id,
      runId,
      finalContent: "done",
    })

    await store.deleteChat(chat.id)

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()
    expect(reloaded.getSubagentRuns(chat.id)).toEqual({})
  })

  test("subagent_entry_appended pushes onto run.entries; result entry mirrors usage", async () => {
    const { dir, store, chatId, baseTs } = await setupStoreWithChat()
    const runId = "r-entries"
    await store.appendSubagentEvent({
      v: 3, type: "subagent_run_started", timestamp: baseTs, chatId, runId,
      subagentId: "s1", subagentName: "alpha", provider: "claude",
      model: "claude-opus-4-7", parentUserMessageId: "u1", parentRunId: null, depth: 0,
    })
    await store.appendSubagentEvent({
      v: 3, type: "subagent_entry_appended", timestamp: baseTs + 1, chatId, runId,
      entry: {
        _id: "e1", createdAt: baseTs + 1, kind: "tool_call",
        tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: "t1", input: { command: "ls" } },
      } as unknown as TranscriptEntry,
    })
    await store.appendSubagentEvent({
      v: 3, type: "subagent_entry_appended", timestamp: baseTs + 2, chatId, runId,
      entry: {
        _id: "e2", createdAt: baseTs + 2, kind: "tool_result", toolId: "t1",
        content: "file.txt\n", isError: false,
      } as unknown as TranscriptEntry,
    })
    await store.appendSubagentEvent({
      v: 3, type: "subagent_entry_appended", timestamp: baseTs + 3, chatId, runId,
      entry: {
        _id: "e3", createdAt: baseTs + 3, kind: "result", subtype: "success", isError: false,
        result: "done", durationMs: 100, costUsd: 0.01,
        usage: { inputTokens: 50, outputTokens: 7, cachedInputTokens: 0 },
      } as unknown as TranscriptEntry,
    })
    await store.appendSubagentEvent({
      v: 3, type: "subagent_run_completed", timestamp: baseTs + 4, chatId, runId,
      finalContent: "file.txt",
    })

    const live = store.getSubagentRuns(chatId)[runId]
    expect(live.entries).toHaveLength(3)
    expect(live.entries[0].kind).toBe("tool_call")
    expect(live.entries[1].kind).toBe("tool_result")
    expect(live.entries[2].kind).toBe("result")
    expect(live.usage).toEqual({ inputTokens: 50, outputTokens: 7, cachedInputTokens: 0, costUsd: 0.01 })

    const reloaded = new EventStore(dir)
    await reloaded.initialize()
    const replayed = reloaded.getSubagentRuns(chatId)[runId]
    expect(replayed.entries).toHaveLength(3)
    expect(replayed.usage?.outputTokens).toBe(7)
  })

  test("subagent_run_completed without usage preserves usage from result entry", async () => {
    const { dir, store, chatId, baseTs } = await setupStoreWithChat()
    const runId = "r-merge"
    await store.appendSubagentEvent({
      v: 3, type: "subagent_run_started", timestamp: baseTs, chatId, runId,
      subagentId: "s1", subagentName: "alpha", provider: "claude",
      model: "claude-opus-4-7", parentUserMessageId: "u1", parentRunId: null, depth: 0,
    })
    await store.appendSubagentEvent({
      v: 3, type: "subagent_entry_appended", timestamp: baseTs + 1, chatId, runId,
      entry: {
        _id: "e1", createdAt: baseTs + 1, kind: "result", subtype: "success", isError: false,
        result: "done", durationMs: 10, costUsd: 0.001,
        usage: { inputTokens: 99, outputTokens: 9 },
      } as unknown as TranscriptEntry,
    })
    await store.appendSubagentEvent({
      v: 3, type: "subagent_run_completed", timestamp: baseTs + 2, chatId, runId,
      finalContent: "done",
    })
    const live = store.getSubagentRuns(chatId)[runId]
    expect(live.usage?.outputTokens).toBe(9)

    const reloaded = new EventStore(dir)
    await reloaded.initialize()
    expect(reloaded.getSubagentRuns(chatId)[runId].usage?.outputTokens).toBe(9)
  })

  test("subagent_tool_pending sets pendingTool on the run", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/p-tool-pending")
    const chat = await store.createChat(project.id)
    const runId = "r-pending"
    const base = chat.createdAt + 1
    await store.appendSubagentEvent({
      v: 3, type: "subagent_run_started", timestamp: base,
      chatId: chat.id, runId, subagentId: "s1", subagentName: "alpha",
      provider: "claude", model: "claude-opus-4-7",
      parentUserMessageId: "u1", parentRunId: null, depth: 0,
    })
    await store.appendSubagentEvent({
      v: 3, type: "subagent_tool_pending", timestamp: base + 5,
      chatId: chat.id, runId, toolUseId: "tool-1",
      toolKind: "ask_user_question",
      input: { questions: [{ id: "q1", question: "ok?" }] },
    })
    const run = store.getSubagentRuns(chat.id)[runId]
    expect(run.pendingTool).toEqual({
      toolUseId: "tool-1",
      toolKind: "ask_user_question",
      input: { questions: [{ id: "q1", question: "ok?" }] },
      requestedAt: base + 5,
    })
  })

  test("subagent_tool_resolved clears pendingTool and appends synthetic tool_result entry", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/p-tool-resolved")
    const chat = await store.createChat(project.id)
    const runId = "r-resolved"
    const base = chat.createdAt + 1
    await store.appendSubagentEvent({
      v: 3, type: "subagent_run_started", timestamp: base,
      chatId: chat.id, runId, subagentId: "s1", subagentName: "alpha",
      provider: "claude", model: "claude-opus-4-7",
      parentUserMessageId: "u1", parentRunId: null, depth: 0,
    })
    await store.appendSubagentEvent({
      v: 3, type: "subagent_tool_pending", timestamp: base + 5,
      chatId: chat.id, runId, toolUseId: "tool-2",
      toolKind: "exit_plan_mode", input: {},
    })
    await store.appendSubagentEvent({
      v: 3, type: "subagent_tool_resolved", timestamp: base + 10,
      chatId: chat.id, runId, toolUseId: "tool-2",
      result: { confirmed: true }, resolution: "user",
    })
    const run = store.getSubagentRuns(chat.id)[runId]
    expect(run.pendingTool).toBeNull()
    const last = run.entries[run.entries.length - 1]
    expect(last.kind).toBe("tool_result")
    expect((last as { toolId: string }).toolId).toBe("tool-2")
    expect((last as { content: unknown }).content).toEqual({ confirmed: true })
  })

  test("subagent_tool_pending and resolved survive replay", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/p-tool-replay")
    const chat = await store.createChat(project.id)
    const runId = "r-replay"
    const base = chat.createdAt + 1
    await store.appendSubagentEvent({
      v: 3, type: "subagent_run_started", timestamp: base,
      chatId: chat.id, runId, subagentId: "s1", subagentName: "alpha",
      provider: "claude", model: "claude-opus-4-7",
      parentUserMessageId: "u1", parentRunId: null, depth: 0,
    })
    await store.appendSubagentEvent({
      v: 3, type: "subagent_tool_pending", timestamp: base + 5,
      chatId: chat.id, runId, toolUseId: "tool-3",
      toolKind: "ask_user_question", input: { questions: [] },
    })
    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()
    const run = reloaded.getSubagentRuns(chat.id)[runId]
    expect(run.pendingTool?.toolUseId).toBe("tool-3")
    expect(run.pendingTool?.toolKind).toBe("ask_user_question")
  })

  test("subagent_entry_appended caps tool_result over threshold", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/p-cap")
    const chat = await store.createChat(project.id)
    const runId = "r-cap"
    const base = chat.createdAt + 1
    await store.appendSubagentEvent({
      v: 3, type: "subagent_run_started", timestamp: base,
      chatId: chat.id, runId, subagentId: "s1", subagentName: "alpha",
      provider: "claude", model: "claude-opus-4-7",
      parentUserMessageId: "u1", parentRunId: null, depth: 0,
    })
    const big = "z".repeat(60_000)
    await store.appendSubagentEvent({
      v: 3, type: "subagent_entry_appended", timestamp: base + 1,
      chatId: chat.id, runId,
      entry: {
        kind: "tool_result",
        _id: "e1",
        createdAt: base + 1,
        toolId: "tool-big",
        content: big,
      } as TranscriptEntry,
    })
    const run = store.getSubagentRuns(chat.id)[runId]
    const last = run.entries[run.entries.length - 1] as { persisted?: { filePath: string; originalSize: number; truncated: true }; content: string }
    expect(last.persisted).toBeDefined()
    expect(last.persisted!.originalSize).toBe(big.length)
    expect(last.persisted!.truncated).toBe(true)
    expect(last.content).toContain("<persisted-output>")
    const onDisk = await Bun.file(last.persisted!.filePath).text()
    expect(onDisk).toBe(big)
  })
})

describe("EventStore auto-continue schedules", () => {
  test("appends and replays AutoContinueEvent sequence", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/p1")
    const chat = await store.createChat(project.id)

    const proposed: AutoContinueEvent = {
      v: 3,
      kind: "auto_continue_proposed",
      timestamp: 1_000,
      chatId: chat.id,
      scheduleId: "s1",
      detectedAt: 1_000,
      resetAt: 2_000,
      tz: "Asia/Saigon",

    }
    const accepted: AutoContinueEvent = {
      v: 3,
      kind: "auto_continue_accepted",
      timestamp: 1_100,
      chatId: chat.id,
      scheduleId: "s1",
      scheduledAt: 2_000,
      tz: "Asia/Saigon",
      source: "user",
      resetAt: 2_000,
      detectedAt: 1_000,
    }
    await store.appendAutoContinueEvent(proposed)
    await store.appendAutoContinueEvent(accepted)

    const rehydrated = new EventStore(dataDir)
    await rehydrated.initialize()
    const events = rehydrated.getAutoContinueEvents(chat.id)
    expect(events).toHaveLength(2)
    expect(events[0].kind).toBe("auto_continue_proposed")
    expect(events[1].kind).toBe("auto_continue_accepted")
  })

  test("snapshot compaction retains auto-continue events", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/p1")
    const chat = await store.createChat(project.id)

    await store.appendAutoContinueEvent({
      v: 3,
      kind: "auto_continue_proposed",
      timestamp: 1_000,
      chatId: chat.id,
      scheduleId: "s1",
      detectedAt: 1_000,
      resetAt: 2_000,
      tz: "Asia/Saigon",

    })
    await store.snapshotAndTruncateLogs()

    const rehydrated = new EventStore(dataDir)
    await rehydrated.initialize()
    expect(rehydrated.getAutoContinueEvents(chat.id)).toHaveLength(1)
  })
})

describe("EventStore tunnel events", () => {
  test("appends two tunnel events and retrieves them in order by chatId", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/p-tunnel")
    const chat = await store.createChat(project.id)

    const proposed = {
      v: 1 as const,
      kind: "tunnel_proposed" as const,
      timestamp: 1_000,
      chatId: chat.id,
      tunnelId: "t1",
      port: 5173,
      sourcePid: null,
    }
    const accepted = {
      v: 1 as const,
      kind: "tunnel_accepted" as const,
      timestamp: 2_000,
      chatId: chat.id,
      tunnelId: "t1",
      source: "user" as const,
    }

    await store.appendTunnelEvent(proposed)
    await store.appendTunnelEvent(accepted)

    const events = store.getTunnelEvents(chat.id)
    expect(events).toHaveLength(2)
    expect(events[0].kind).toBe("tunnel_proposed")
    expect(events[1].kind).toBe("tunnel_accepted")
  })

  test("persists tunnel events across store restart", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/p-tunnel2")
    const chat = await store.createChat(project.id)

    await store.appendTunnelEvent({
      v: 1 as const,
      kind: "tunnel_proposed" as const,
      timestamp: 1_000,
      chatId: chat.id,
      tunnelId: "t2",
      port: 3000,
      sourcePid: 42,
    })

    const rehydrated = new EventStore(dataDir)
    await rehydrated.initialize()
    const events = rehydrated.getTunnelEvents(chat.id)
    expect(events).toHaveLength(1)
    if (events[0].kind === "tunnel_proposed") {
      expect(events[0].port).toBe(3000)
      expect(events[0].sourcePid).toBe(42)
    } else {
      throw new Error("expected tunnel_proposed")
    }
  })

  test("returns empty array for unknown chatId", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    expect(store.getTunnelEvents("nonexistent")).toEqual([])
  })
})

describe("EventStore push events", () => {
  test("appends and reloads push events", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    await store.appendPushEvent({
      kind: "subscription_added",
      ts: 1700000000000,
      id: "sub-1",
      record: {
        id: "sub-1",
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
        label: "iPhone",
        userAgent: "Mozilla/5.0",
        createdAt: 1700000000000,
        lastSeenAt: 1700000000000,
      },
    })
    await store.appendPushEvent({
      kind: "project_mute_set",
      ts: 1700000000001,
      localPath: "/tmp/proj-a",
      muted: true,
    })

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()
    const events = await reloaded.loadPushEvents()
    expect(events).toHaveLength(2)
    expect(events[0].kind).toBe("subscription_added")
    expect(events[1].kind).toBe("project_mute_set")
  })
})

// Helper: apply a raw store event directly (bypasses file I/O for unit testing)
function applyRaw(store: EventStore, event: Record<string, unknown>) {
  ;(store as any).applyEvent(event)
}

describe("ChatTimingState accumulator", () => {
  test("chat_created seeds idle state with createdAt", () => {
    const store = new EventStore("/tmp/test-timings-1")
    applyRaw(store, { v: 3, type: "project_opened", timestamp: 1000, projectId: "p1", localPath: "/x", title: "X" })
    applyRaw(store, { v: 3, type: "chat_created", timestamp: 2000, chatId: "c1", projectId: "p1", title: "T" })

    const t = store.state.chatTimingsByChatId.get("c1")
    expect(t).toBeDefined()
    expect(t!.status).toBe("idle")
    expect(t!.stateEnteredAt).toBe(2000)
    expect(t!.activeSessionStartedAt).toBe(2000)
    expect(t!.cumulativeMs).toEqual({ idle: 0, starting: 0, running: 0, failed: 0 })
  })

  test("turn_started transitions idle -> running and accumulates idle time", () => {
    const store = new EventStore("/tmp/test-timings-2")
    applyRaw(store, { v: 3, type: "project_opened", timestamp: 1000, projectId: "p1", localPath: "/x", title: "X" })
    applyRaw(store, { v: 3, type: "chat_created", timestamp: 2000, chatId: "c1", projectId: "p1", title: "T" })
    applyRaw(store, { v: 3, type: "turn_started", timestamp: 5000, chatId: "c1" })

    const t = store.state.chatTimingsByChatId.get("c1")!
    expect(t.status).toBe("running")
    expect(t.stateEnteredAt).toBe(5000)
    expect(t.cumulativeMs.idle).toBe(3000)
    expect(t.cumulativeMs.running).toBe(0)
    expect(t.lastTurnStartedAt).toBe(5000)
  })

  test("turn_finished transitions running -> idle, sets lastTurnDurationMs", () => {
    const store = new EventStore("/tmp/test-timings-3")
    applyRaw(store, { v: 3, type: "project_opened", timestamp: 1000, projectId: "p1", localPath: "/x", title: "X" })
    applyRaw(store, { v: 3, type: "chat_created", timestamp: 2000, chatId: "c1", projectId: "p1", title: "T" })
    applyRaw(store, { v: 3, type: "turn_started", timestamp: 5000, chatId: "c1" })
    applyRaw(store, { v: 3, type: "turn_finished", timestamp: 8000, chatId: "c1" })

    const t = store.state.chatTimingsByChatId.get("c1")!
    expect(t.status).toBe("idle")
    expect(t.stateEnteredAt).toBe(8000)
    expect(t.cumulativeMs.idle).toBe(3000)
    expect(t.cumulativeMs.running).toBe(3000)
    expect(t.lastTurnDurationMs).toBe(3000)
  })

  test("turn_failed transitions running -> failed", () => {
    const store = new EventStore("/tmp/test-timings-4")
    applyRaw(store, { v: 3, type: "project_opened", timestamp: 1000, projectId: "p1", localPath: "/x", title: "X" })
    applyRaw(store, { v: 3, type: "chat_created", timestamp: 2000, chatId: "c1", projectId: "p1", title: "T" })
    applyRaw(store, { v: 3, type: "turn_started", timestamp: 5000, chatId: "c1" })
    applyRaw(store, { v: 3, type: "turn_failed", timestamp: 7000, chatId: "c1", error: "boom" })

    const t = store.state.chatTimingsByChatId.get("c1")!
    expect(t.status).toBe("failed")
    expect(t.stateEnteredAt).toBe(7000)
    expect(t.cumulativeMs.running).toBe(2000)
  })

  test("idle gap > ACTIVE_SESSION_IDLE_GAP_MS resets activeSessionStartedAt and cumulative", () => {
    const store = new EventStore("/tmp/test-timings-5")
    const gap = ACTIVE_SESSION_IDLE_GAP_MS + 1
    applyRaw(store, { v: 3, type: "project_opened", timestamp: 1000, projectId: "p1", localPath: "/x", title: "X" })
    applyRaw(store, { v: 3, type: "chat_created", timestamp: 2000, chatId: "c1", projectId: "p1", title: "T" })
    applyRaw(store, { v: 3, type: "turn_started", timestamp: 5000, chatId: "c1" })
    applyRaw(store, { v: 3, type: "turn_finished", timestamp: 8000, chatId: "c1" })
    // Gap of ACTIVE_SESSION_IDLE_GAP_MS + 1 ms > threshold
    applyRaw(store, { v: 3, type: "turn_started", timestamp: 8000 + gap, chatId: "c1" })

    const t = store.state.chatTimingsByChatId.get("c1")!
    expect(t.activeSessionStartedAt).toBe(8000 + gap)
    expect(t.cumulativeMs.idle).toBe(0)
    expect(t.cumulativeMs.running).toBe(0)
    expect(t.status).toBe("running")
    expect(t.stateEnteredAt).toBe(8000 + gap)
  })

  test("idle gap exactly equal to ACTIVE_SESSION_IDLE_GAP_MS does NOT reset (strict >)", () => {
    const store = new EventStore("/tmp/test-timings-boundary")
    applyRaw(store, { v: 3, type: "project_opened", timestamp: 1000, projectId: "p1", localPath: "/x", title: "X" })
    applyRaw(store, { v: 3, type: "chat_created", timestamp: 2000, chatId: "c1", projectId: "p1", title: "T" })
    applyRaw(store, { v: 3, type: "turn_started", timestamp: 5000, chatId: "c1" })
    applyRaw(store, { v: 3, type: "turn_finished", timestamp: 8000, chatId: "c1" })
    applyRaw(store, { v: 3, type: "turn_started", timestamp: 8000 + ACTIVE_SESSION_IDLE_GAP_MS, chatId: "c1" })

    const t = store.state.chatTimingsByChatId.get("c1")!
    // Active session preserved (no reset since gap is not strictly greater)
    expect(t.activeSessionStartedAt).toBe(2000)
    // Cumulative idle includes the full threshold gap (8000→8000+gap) plus the original 3000 (2000→5000)
    expect(t.cumulativeMs.idle).toBe(3000 + ACTIVE_SESSION_IDLE_GAP_MS)
  })
})

describe("project star", () => {
  test("applies project_star_set with timestamp", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/proj-a")

    await store.setProjectStar(project.id, true)

    const after = store.getProject(project.id)!
    expect(after.starredAt).toBeGreaterThan(0)
  })

  test("applies project_star_set with null clears starredAt", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/proj-a")
    await store.setProjectStar(project.id, true)

    await store.setProjectStar(project.id, false)

    const after = store.getProject(project.id)!
    expect(after.starredAt).toBeUndefined()
  })

  test("starredAt survives replay", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/proj-a")
    await store.setProjectStar(project.id, true)
    const starredAtBefore = store.getProject(project.id)!.starredAt

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()

    expect(reloaded.getProject(project.id)!.starredAt).toBe(starredAtBefore)
  })

  test("legacy session_token_set attributes to chat.provider at replay time", async () => {
    const dataDir = await createTempDataDir()
    const projectId = "p1"
    const chatId = "c1"
    const now = 1_700_000_000_000
    await writeFile(
      join(dataDir, "projects.jsonl"),
      `${JSON.stringify({ v: 3, type: "project_opened", timestamp: now, projectId, localPath: "/tmp/x", title: "x" })}\n`,
      "utf8",
    )
    await writeFile(
      join(dataDir, "chats.jsonl"),
      [
        { v: 3, type: "chat_created", timestamp: now + 1, chatId, projectId, title: "t" },
        { v: 3, type: "chat_provider_set", timestamp: now + 2, chatId, provider: "claude" },
        { v: 3, type: "chat_provider_set", timestamp: now + 4, chatId, provider: "codex" },
      ].map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    )
    await writeFile(
      join(dataDir, "turns.jsonl"),
      [
        { v: 3, type: "session_token_set", timestamp: now + 3, chatId, sessionToken: "tok-claude-1" },
        { v: 3, type: "session_token_set", timestamp: now + 5, chatId, sessionToken: "tok-codex-1" },
      ].map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    )

    const store = new EventStore(dataDir)
    await store.initialize()

    const record = store.getChat(chatId)!
    expect(record.sessionTokensByProvider.claude).toBe("tok-claude-1")
    expect(record.sessionTokensByProvider.codex).toBe("tok-codex-1")
  })

  test("session_token_set with explicit provider writes to that slot", async () => {
    const dataDir = await createTempDataDir()
    const projectId = "p1"
    const chatId = "c1"
    const now = 1_700_000_000_000
    await writeFile(
      join(dataDir, "projects.jsonl"),
      `${JSON.stringify({ v: 3, type: "project_opened", timestamp: now, projectId, localPath: "/tmp/x", title: "x" })}\n`,
      "utf8",
    )
    await writeFile(
      join(dataDir, "chats.jsonl"),
      [
        { v: 3, type: "chat_created", timestamp: now + 1, chatId, projectId, title: "t" },
        { v: 3, type: "chat_provider_set", timestamp: now + 2, chatId, provider: "claude" },
      ].map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    )
    await writeFile(
      join(dataDir, "turns.jsonl"),
      `${JSON.stringify({ v: 3, type: "session_token_set", timestamp: now + 3, chatId, sessionToken: "x-codex", provider: "codex" })}\n`,
      "utf8",
    )

    const store = new EventStore(dataDir)
    await store.initialize()

    const record = store.getChat(chatId)!
    expect(record.sessionTokensByProvider.codex).toBe("x-codex")
    expect(record.sessionTokensByProvider.claude).toBeUndefined()
  })

  test("legacy pending_fork_session_token_set becomes provider-tagged via chat.provider", async () => {
    const dataDir = await createTempDataDir()
    const projectId = "p1"
    const chatId = "c1"
    const now = 1_700_000_000_000
    await writeFile(
      join(dataDir, "projects.jsonl"),
      `${JSON.stringify({ v: 3, type: "project_opened", timestamp: now, projectId, localPath: "/tmp/x", title: "x" })}\n`,
      "utf8",
    )
    await writeFile(
      join(dataDir, "chats.jsonl"),
      [
        { v: 3, type: "chat_created", timestamp: now + 1, chatId, projectId, title: "t" },
        { v: 3, type: "chat_provider_set", timestamp: now + 2, chatId, provider: "claude" },
      ].map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    )
    await writeFile(
      join(dataDir, "turns.jsonl"),
      `${JSON.stringify({ v: 3, type: "pending_fork_session_token_set", timestamp: now + 3, chatId, pendingForkSessionToken: "fork-tok" })}\n`,
      "utf8",
    )

    const store = new EventStore(dataDir)
    await store.initialize()

    const record = store.getChat(chatId)!
    expect(record.pendingForkSessionToken).toEqual({ provider: "claude", token: "fork-tok" })
  })
})

function fixtureToolRequest(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    id: "id-1",
    chatId: "chat-1",
    sessionId: "sess-1",
    toolUseId: "tu-1",
    toolName: "ask_user_question",
    arguments: { questions: [] },
    canonicalArgsHash: "hash-1",
    policyVerdict: "ask",
    status: "pending",
    createdAt: 1_000,
    expiresAt: 1_000 + 600_000,
    ...overrides,
  }
}

describe("EventStore ToolRequest", () => {
  test("putToolRequest then getToolRequest returns the same record", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    await store.putToolRequest(fixtureToolRequest())
    const got = await store.getToolRequest("id-1")
    expect(got?.toolUseId).toBe("tu-1")
  })

  test("listPendingToolRequests filters by chatId", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    await store.putToolRequest(fixtureToolRequest({ id: "a", chatId: "c1" }))
    await store.putToolRequest(fixtureToolRequest({ id: "b", chatId: "c2" }))
    await store.putToolRequest(fixtureToolRequest({ id: "c", chatId: "c1", status: "answered" }))
    const pending = await store.listPendingToolRequests("c1")
    expect(pending.map((r) => r.id).sort()).toEqual(["a"])
  })

  test("resolveToolRequest sets terminal status atomically", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    await store.putToolRequest(fixtureToolRequest())
    await store.resolveToolRequest("id-1", {
      status: "answered",
      decision: { kind: "answer", payload: { ok: true } },
      resolvedAt: 2_000,
    })
    const got = await store.getToolRequest("id-1")
    expect(got?.status).toBe("answered")
    expect(got?.decision?.kind).toBe("answer")
  })

  test("putToolRequest survives restart via replay", async () => {
    const dataDir = await createTempDataDir()
    const store1 = new EventStore(dataDir)
    await store1.initialize()
    await store1.putToolRequest(fixtureToolRequest({ id: "persisted-id", chatId: "c-1" }))
    await store1.resolveToolRequest("persisted-id", {
      status: "answered",
      decision: { kind: "answer", payload: { ok: true } },
      resolvedAt: 5_000,
    })

    // Simulate restart: drop instance, create a new one against the same dataDir.
    const store2 = new EventStore(dataDir)
    await store2.initialize()
    const replayed = await store2.getToolRequest("persisted-id")
    expect(replayed?.status).toBe("answered")
    expect(replayed?.decision?.payload).toEqual({ ok: true })
  })
})

describe("EventStore getRecentChatHistory pending replay", () => {
  test("includes pending_tool_request synthetic entries for pending records", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    await store.putToolRequest(fixtureToolRequest({ id: "req-1", chatId: chat.id, createdAt: 5_000 }))

    const { messages } = store.getRecentChatHistory(chat.id, 10)
    const synthetic = messages.filter((m) => m.kind === "pending_tool_request")

    expect(synthetic).toHaveLength(1)
    expect(synthetic[0]).toMatchObject({
      _id: "pending-tool-request-req-1",
      createdAt: 5_000,
      kind: "pending_tool_request",
      toolRequestId: "req-1",
      toolName: "ask_user_question",
      arguments: { questions: [] },
    })
  })

  test("does NOT include resolved tool requests as synthetic entries", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    await store.putToolRequest(fixtureToolRequest({ id: "req-resolved", chatId: chat.id }))
    await store.resolveToolRequest("req-resolved", {
      status: "answered",
      decision: { kind: "answer", payload: { ok: true } },
      resolvedAt: 2_000,
    })

    const { messages } = store.getRecentChatHistory(chat.id, 10)
    const synthetic = messages.filter((m) => m.kind === "pending_tool_request")

    expect(synthetic).toHaveLength(0)
  })

  test("synthetic entry id is deterministic across calls", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    await store.putToolRequest(fixtureToolRequest({ id: "req-dedup", chatId: chat.id }))

    const first = store.getRecentChatHistory(chat.id, 10)
    const second = store.getRecentChatHistory(chat.id, 10)

    const firstSynthetic = first.messages.filter((m) => m.kind === "pending_tool_request")
    const secondSynthetic = second.messages.filter((m) => m.kind === "pending_tool_request")

    expect(firstSynthetic[0]._id).toBe(secondSynthetic[0]._id)
    expect(firstSynthetic[0]._id).toBe("pending-tool-request-req-dedup")
  })
})

describe("EventStore deleteChat prunes toolRequestsById", () => {
  test("after putToolRequest + deleteChat, getToolRequest returns null for that chat's requests", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    await store.putToolRequest(fixtureToolRequest({ id: "req-to-prune", chatId: chat.id }))
    expect(store.getToolRequest("req-to-prune")).not.toBeNull()

    await store.deleteChat(chat.id)

    expect(store.getToolRequest("req-to-prune")).toBeNull()
  })

  test("deleteChat only prunes tool requests for the deleted chat", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chatA = await store.createChat(project.id)
    const chatB = await store.createChat(project.id)

    await store.putToolRequest(fixtureToolRequest({ id: "req-a", chatId: chatA.id }))
    await store.putToolRequest(fixtureToolRequest({ id: "req-b", chatId: chatB.id }))

    await store.deleteChat(chatA.id)

    expect(store.getToolRequest("req-a")).toBeNull()
    expect(store.getToolRequest("req-b")).not.toBeNull()
  })

  test("appendMessage dedupes entries with same messageId (JSONL replay safety)", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    const baseEntry = {
      _id: "first-id",
      kind: "assistant_text" as const,
      createdAt: 100,
      text: "hello",
      messageId: "claude-msg-1",
    } as TranscriptEntry

    await store.appendMessage(chat.id, baseEntry)
    // Simulate JSONL re-emit with a fresh _id but same messageId.
    await store.appendMessage(chat.id, { ...baseEntry, _id: "duplicate-id" } as TranscriptEntry)

    const messages = store.getMessages(chat.id)
    expect(messages).toHaveLength(1)
    expect(messages[0]._id).toBe("first-id")
  })

  test("appendMessage does not dedupe entries without messageId", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()

    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    const e1 = { _id: "a", kind: "interrupted" as const, createdAt: 100 } as TranscriptEntry
    const e2 = { _id: "b", kind: "interrupted" as const, createdAt: 200 } as TranscriptEntry

    await store.appendMessage(chat.id, e1)
    await store.appendMessage(chat.id, e2)

    expect(store.getMessages(chat.id)).toHaveLength(2)
  })

  test("appendMessage dedupes across a fresh EventStore (replay populates seen set)", async () => {
    const dataDir = await createTempDataDir()
    const first = new EventStore(dataDir)
    await first.initialize()

    const project = await first.openProject("/tmp/project")
    const chat = await first.createChat(project.id)

    await first.appendMessage(chat.id, {
      _id: "id-1",
      kind: "assistant_text",
      createdAt: 100,
      text: "hello",
      messageId: "claude-msg-1",
    } as TranscriptEntry)

    // New EventStore instance against the same dataDir simulates restart.
    const second = new EventStore(dataDir)
    await second.initialize()
    // Force transcript load so seen set is populated.
    expect(second.getMessages(chat.id)).toHaveLength(1)

    await second.appendMessage(chat.id, {
      _id: "id-2",
      kind: "assistant_text",
      createdAt: 200,
      text: "hello",
      messageId: "claude-msg-1",
    } as TranscriptEntry)

    expect(second.getMessages(chat.id)).toHaveLength(1)
  })

  test("compactFailureCount defaults to 0 and survives a restart", async () => {
    const dataDir = await createTempDataDir()
    const store = new EventStore(dataDir)
    await store.initialize()
    const project = await store.openProject("/tmp/project")
    const chat = await store.createChat(project.id)

    expect(store.getChat(chat.id)?.compactFailureCount ?? 0).toBe(0)

    await store.setCompactFailureCount(chat.id, 2)
    expect(store.getChat(chat.id)?.compactFailureCount).toBe(2)

    const reloaded = new EventStore(dataDir)
    await reloaded.initialize()
    expect(reloaded.getChat(chat.id)?.compactFailureCount).toBe(2)

    await reloaded.setCompactFailureCount(chat.id, 0)
    expect(reloaded.getChat(chat.id)?.compactFailureCount).toBe(0)
  })
})
