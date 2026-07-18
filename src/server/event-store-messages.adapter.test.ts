import { describe, expect, test } from "bun:test"
import type { QueuedChatMessage, TranscriptEntry } from "../shared/types"
import type { StorageBackend } from "./storage/backend"
import type { ToolRequest } from "../shared/permission-policy"
import type { ChatRecord } from "./events"
import {
  TranscriptCache,
  getChatCount,
  getMessages,
  getMessagesPageBefore,
  getQueuedMessage,
  getQueuedMessages,
  getRecentChatHistory,
  getRecentMessagesPage,
  getSeenMessageIds,
  loadTranscriptFromDisk,
  type MessageReadDeps,
} from "./event-store-messages.adapter"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorage(files: Map<string, string> = new Map()): StorageBackend {
  return {
    mkdir: async () => {},
    exists: async (p) => files.has(p),
    existsSync: (p) => files.has(p),
    size: async (p) => files.get(p)?.length ?? 0,
    readText: async (p) => files.get(p) ?? "",
    readTextSync: (p) => files.get(p) ?? "",
    writeText: async (p, v) => { files.set(p, v) },
    appendText: async (p, v) => { files.set(p, (files.get(p) ?? "") + v) },
    rename: async () => {},
    remove: async () => {},
  }
}

function makeTranscriptEntry(_chatId = "chat-1", kind: "user_prompt" | "assistant_text" = "user_prompt", extra: Partial<TranscriptEntry> = {}): TranscriptEntry {
  const _id = `${kind}-${Math.random()}`
  if (kind === "user_prompt") {
    return { _id, createdAt: 1000, kind: "user_prompt", content: "hello", ...extra } as TranscriptEntry
  }
  return { _id, createdAt: 1001, kind: "assistant_text", text: "world", ...extra } as TranscriptEntry
}

function makeQueuedMessage(overrides: Partial<QueuedChatMessage> = {}): QueuedChatMessage {
  return {
    id: "qm-1",
    content: "queued message",
    attachments: [],
    createdAt: 2000,
    ...overrides,
  }
}

function makeChatRecord(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    id: "chat-1",
    projectId: "proj-1",
    title: "Chat 1",
    createdAt: 1000,
    updatedAt: 1000,
    unread: false,
    provider: null,
    planMode: false,
    sessionTokensByProvider: {},
    sourceHash: null,
    lastTurnOutcome: null,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<MessageReadDeps> = {}): MessageReadDeps {
  return {
    storage: makeStorage(),
    transcriptsDir: "/data/transcripts",
    transcriptCache: new TranscriptCache(),
    legacyMessagesByChatId: new Map(),
    seenMessageIdsByChatId: new Map(),
    queuedMessagesByChatId: new Map(),
    chatsById: new Map(),
    listPendingToolRequests: (_chatId) => [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// getSeenMessageIds
// ---------------------------------------------------------------------------

describe("getSeenMessageIds", () => {
  test("creates an empty set for unknown chatId", () => {
    const deps = makeDeps()
    const set = getSeenMessageIds(deps, "chat-x")
    expect(set.size).toBe(0)
  })

  test("returns the same set on repeated calls for the same chatId", () => {
    const deps = makeDeps()
    const s1 = getSeenMessageIds(deps, "chat-x")
    s1.add("msg-1")
    const s2 = getSeenMessageIds(deps, "chat-x")
    expect(s2.has("msg-1")).toBe(true)
    expect(s1).toBe(s2)
  })

  test("returns distinct sets for different chatIds", () => {
    const deps = makeDeps()
    const sa = getSeenMessageIds(deps, "chat-a")
    const sb = getSeenMessageIds(deps, "chat-b")
    expect(sa).not.toBe(sb)
  })
})

// ---------------------------------------------------------------------------
// loadTranscriptFromDisk
// ---------------------------------------------------------------------------

describe("loadTranscriptFromDisk", () => {
  test("returns empty array when file does not exist", () => {
    const deps = makeDeps()
    expect(loadTranscriptFromDisk(deps, "chat-1")).toEqual([])
  })

  test("returns empty array for empty file", () => {
    const files = new Map([["/data/transcripts/chat-1.jsonl", ""]])
    const deps = makeDeps({ storage: makeStorage(files) })
    expect(loadTranscriptFromDisk(deps, "chat-1")).toEqual([])
  })

  test("parses entries from JSONL file", () => {
    const e1 = makeTranscriptEntry("chat-1", "user_prompt")
    const e2 = makeTranscriptEntry("chat-1", "assistant_text")
    const content = `${JSON.stringify(e1)}\n${JSON.stringify(e2)}\n`
    const files = new Map([["/data/transcripts/chat-1.jsonl", content]])
    const deps = makeDeps({ storage: makeStorage(files) })

    const result = loadTranscriptFromDisk(deps, "chat-1")
    expect(result.length).toBe(2)
    expect(result[0]!._id).toBe(e1._id)
    expect(result[1]!._id).toBe(e2._id)
  })

  test("populates seenMessageIds set for entries with messageId", () => {
    const e1: TranscriptEntry = { ...makeTranscriptEntry("chat-1"), messageId: "mid-1" } as TranscriptEntry & { messageId: string }
    const content = `${JSON.stringify(e1)}\n`
    const files = new Map([["/data/transcripts/chat-1.jsonl", content]])
    const seenMessageIdsByChatId = new Map<string, Set<string>>()
    const deps = makeDeps({ storage: makeStorage(files), seenMessageIdsByChatId })

    loadTranscriptFromDisk(deps, "chat-1")

    const seen = seenMessageIdsByChatId.get("chat-1")
    expect(seen?.has("mid-1")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getMessages
// ---------------------------------------------------------------------------

describe("getMessages", () => {
  test("returns from cache when chatId matches", () => {
    const e1 = makeTranscriptEntry("chat-1")
    const transcriptCache = new TranscriptCache()
    transcriptCache.set("chat-1", [e1])
    const deps = makeDeps({ transcriptCache })

    const result = getMessages(deps, "chat-1")
    expect(result[0]!._id).toBe(e1._id)
  })

  test("reads from legacy map and populates cache", () => {
    const e1 = makeTranscriptEntry("chat-2")
    const legacyMessagesByChatId = new Map([["chat-2", [e1]]])
    const transcriptCache = new TranscriptCache()
    const deps = makeDeps({ legacyMessagesByChatId, transcriptCache })

    const result = getMessages(deps, "chat-2")
    expect(result[0]!._id).toBe(e1._id)
    expect(transcriptCache.has("chat-2")).toBe(true)
  })

  test("loads from disk when no cache and no legacy data", () => {
    const e1 = makeTranscriptEntry("chat-3")
    const content = `${JSON.stringify(e1)}\n`
    const files = new Map([["/data/transcripts/chat-3.jsonl", content]])
    const transcriptCache = new TranscriptCache()
    const deps = makeDeps({ storage: makeStorage(files), transcriptCache })

    const result = getMessages(deps, "chat-3")
    expect(result[0]!._id).toBe(e1._id)
    expect(transcriptCache.has("chat-3")).toBe(true)
  })

  test("returns a clone (not the cached reference)", () => {
    const e1 = makeTranscriptEntry("chat-1")
    const entries = [e1]
    const transcriptCache = new TranscriptCache()
    transcriptCache.set("chat-1", entries)
    const deps = makeDeps({ transcriptCache })

    const r1 = getMessages(deps, "chat-1")
    const r2 = getMessages(deps, "chat-1")
    expect(r1).not.toBe(r2)
    expect(r1).not.toBe(entries)
  })
})

// ---------------------------------------------------------------------------
// getQueuedMessages
// ---------------------------------------------------------------------------

describe("getQueuedMessages", () => {
  test("returns empty array for unknown chat", () => {
    const deps = makeDeps()
    expect(getQueuedMessages(deps, "chat-x")).toEqual([])
  })

  test("returns messages with cloned attachments", () => {
    const msg = makeQueuedMessage({ id: "qm-1", attachments: [] })
    const queuedMessagesByChatId = new Map([["chat-1", [msg]]])
    const deps = makeDeps({ queuedMessagesByChatId })

    const result = getQueuedMessages(deps, "chat-1")
    expect(result[0]!.id).toBe("qm-1")
    expect(result[0]!.attachments).not.toBe(msg.attachments)
  })
})

// ---------------------------------------------------------------------------
// getQueuedMessage
// ---------------------------------------------------------------------------

describe("getQueuedMessage", () => {
  test("returns null for unknown queuedMessageId", () => {
    const msg = makeQueuedMessage({ id: "qm-1" })
    const queuedMessagesByChatId = new Map([["chat-1", [msg]]])
    const deps = makeDeps({ queuedMessagesByChatId })
    expect(getQueuedMessage(deps, "chat-1", "qm-99")).toBeNull()
  })

  test("returns the matching message", () => {
    const msg1 = makeQueuedMessage({ id: "qm-1", content: "first" })
    const msg2 = makeQueuedMessage({ id: "qm-2", content: "second" })
    const queuedMessagesByChatId = new Map([["chat-1", [msg1, msg2]]])
    const deps = makeDeps({ queuedMessagesByChatId })

    const result = getQueuedMessage(deps, "chat-1", "qm-2")
    expect(result?.content).toBe("second")
  })
})

// ---------------------------------------------------------------------------
// getRecentMessagesPage
// ---------------------------------------------------------------------------

describe("getRecentMessagesPage", () => {
  test("returns empty page for limit 0", () => {
    const deps = makeDeps()
    const page = getRecentMessagesPage(deps, "chat-1", 0)
    expect(page.messages).toEqual([])
    expect(page.hasOlder).toBe(false)
    expect(page.olderCursor).toBeNull()
  })

  test("returns up to limit messages", () => {
    const entries = [1, 2, 3, 4, 5].map((i) => ({
      _id: `e-${i}`,
      createdAt: i * 100,
      kind: "assistant_text" as const,
      text: `msg ${i}`,
    }))
    const transcriptCache = new TranscriptCache()
    transcriptCache.set("chat-1", entries)
    const deps = makeDeps({ transcriptCache })
    const page = getRecentMessagesPage(deps, "chat-1", 3)
    expect(page.messages.length).toBe(3)
  })

  test("hasOlder is true when there are more messages than limit", () => {
    const entries = [1, 2, 3, 4, 5].map((i) => ({
      _id: `e-${i}`,
      createdAt: i * 100,
      kind: "assistant_text" as const,
      text: `msg ${i}`,
    }))
    const transcriptCache = new TranscriptCache()
    transcriptCache.set("chat-1", entries)
    const deps = makeDeps({ transcriptCache })
    const page = getRecentMessagesPage(deps, "chat-1", 3)
    expect(page.hasOlder).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getMessagesPageBefore
// ---------------------------------------------------------------------------

describe("getMessagesPageBefore", () => {
  test("returns empty page for limit 0", () => {
    const deps = makeDeps()
    const page = getMessagesPageBefore(deps, "chat-1", "cursor:0", 0)
    expect(page.messages).toEqual([])
    expect(page.hasOlder).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getRecentChatHistory
// ---------------------------------------------------------------------------

describe("getRecentChatHistory", () => {
  test("includes pending tool request entries", () => {
    const req = {
      id: "req-1",
      chatId: "chat-1",
      toolName: "Bash",
      arguments: { command: "ls" },
      createdAt: 9000,
    } as unknown as ToolRequest
    const listPendingToolRequests = (_chatId: string) => [req]
    const deps = makeDeps({ listPendingToolRequests })

    const { messages } = getRecentChatHistory(deps, "chat-1", 50)
    const pendingEntry = messages.find((m) => m.kind === "pending_tool_request")
    expect(pendingEntry).toBeDefined()
    expect(pendingEntry?.kind === "pending_tool_request" && pendingEntry.toolName).toBe("Bash")
  })

  test("returns history snapshot", () => {
    const deps = makeDeps()
    const result = getRecentChatHistory(deps, "chat-1", 50)
    expect(result.history).toBeDefined()
    expect(result.messages).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// getChatCount
// ---------------------------------------------------------------------------

describe("getChatCount", () => {
  test("returns 0 for project with no chats", () => {
    const deps = makeDeps()
    expect(getChatCount(deps, "proj-1")).toBe(0)
  })

  test("counts only non-deleted, non-archived chats for the project", () => {
    const chatsById = new Map([
      ["c1", makeChatRecord({ id: "c1", projectId: "proj-1" })],
      ["c2", makeChatRecord({ id: "c2", projectId: "proj-1", deletedAt: 1000 })],
      ["c3", makeChatRecord({ id: "c3", projectId: "proj-1", archivedAt: 1000 })],
      ["c4", makeChatRecord({ id: "c4", projectId: "proj-2" })],
    ])
    const deps = makeDeps({ chatsById })
    expect(getChatCount(deps, "proj-1")).toBe(1)
    expect(getChatCount(deps, "proj-2")).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// TranscriptCache (LRU) + window-only cloning
// ---------------------------------------------------------------------------

describe("TranscriptCache", () => {
  function countingStorage(files: Map<string, string>): { storage: StorageBackend; reads: () => number } {
    let readCount = 0
    const base = makeStorage(files)
    return {
      storage: {
        ...base,
        readTextSync: (p) => {
          readCount += 1
          return files.get(p) ?? ""
        },
      },
      reads: () => readCount,
    }
  }

  function transcriptFile(chatId: string): [string, string] {
    const entries = [
      JSON.stringify({ _id: `${chatId}-1`, createdAt: 1, kind: "user_prompt", content: "hi" }),
      JSON.stringify({ _id: `${chatId}-2`, createdAt: 2, kind: "assistant_text", text: "yo" }),
    ].join("\n")
    return [`/data/transcripts/${chatId}.jsonl`, `${entries}\n`]
  }

  test("keeps up to 4 chats; 5th distinct load evicts the LRU", () => {
    const files = new Map([
      transcriptFile("chat-a"), transcriptFile("chat-b"), transcriptFile("chat-c"),
      transcriptFile("chat-d"), transcriptFile("chat-e"),
    ])
    const { storage, reads } = countingStorage(files)
    const deps = makeDeps({ storage, transcriptCache: new TranscriptCache(4) })

    for (const id of ["chat-a", "chat-b", "chat-c", "chat-d"]) getMessages(deps, id)
    expect(reads()).toBe(4)
    getMessages(deps, "chat-b") // cache hit, touches LRU order
    expect(reads()).toBe(4)
    getMessages(deps, "chat-e") // evicts chat-a (LRU)
    expect(reads()).toBe(5)
    getMessages(deps, "chat-b") // still cached
    expect(reads()).toBe(5)
    getMessages(deps, "chat-a") // was evicted -> disk again
    expect(reads()).toBe(6)
  })

  test("page reads clone only the returned window (mutation does not leak into cache)", () => {
    const files = new Map([transcriptFile("chat-a")])
    const deps = makeDeps({ storage: makeStorage(files), transcriptCache: new TranscriptCache(4) })

    const page = getRecentMessagesPage(deps, "chat-a", 10)
    const first = page.messages[0]
    if (!first || first.kind !== "user_prompt") throw new Error("expected user_prompt")
    first.content = "MUTATED"

    const again = getRecentMessagesPage(deps, "chat-a", 10)
    const againFirst = again.messages[0]
    if (!againFirst || againFirst.kind !== "user_prompt") throw new Error("expected user_prompt")
    expect(againFirst.content).toBe("hi")
  })

  test("appendTo updates a cached chat and no-ops for uncached chats", () => {
    const files = new Map([transcriptFile("chat-a")])
    const cache = new TranscriptCache(4)
    const deps = makeDeps({ storage: makeStorage(files), transcriptCache: cache })

    getMessages(deps, "chat-a")
    cache.appendTo("chat-a", makeTranscriptEntry("chat-a", "assistant_text", { _id: "appended" }))
    const page = getRecentMessagesPage(deps, "chat-a", 10)
    expect(page.messages.some((m) => m._id === "appended")).toBe(true)

    cache.appendTo("chat-z", makeTranscriptEntry("chat-z"))
    expect(cache.has("chat-z")).toBe(false)
  })
})
