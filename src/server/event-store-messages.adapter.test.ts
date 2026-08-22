import { describe, expect, test } from "bun:test"
import type { QueuedChatMessage, TranscriptEntry } from "../shared/types"
import type { StorageBackend } from "./storage/backend"
import type { ToolRequest } from "../shared/permission-policy"
import type { ChatRecord } from "./events"
import {
  TranscriptCache,
  getChatCount,
  getRecentMessagesPageTail,
  readTranscriptTail,
  getMessages,
  getMessagesPageBefore,
  getQueuedMessage,
  getQueuedMessages,
  getRecentChatHistory,
  getRecentMessagesPage,
  getLatestChatContextWindowUsage,
  getSeenMessageIds,
  getRecentRawEntries,
  loadTranscriptFromDisk,
  getMessagesView,
  type MessageReadDeps,
} from "./event-store-messages.adapter"
import { getLatestContextWindowUsage } from "./proactive-compact"

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

  test("evicts on the byte budget while still under the chat cap", () => {
    const files = new Map([
      transcriptFile("chat-a"), transcriptFile("chat-b"), transcriptFile("chat-c"),
    ])
    const { storage, reads } = countingStorage(files)
    // One transcript is ~150 bytes; a 260-byte budget holds two, not four.
    const deps = makeDeps({ storage, transcriptCache: new TranscriptCache(4, 260) })

    getMessages(deps, "chat-a")
    getMessages(deps, "chat-b")
    expect(reads()).toBe(2)
    getMessages(deps, "chat-c") // budget exceeded -> evicts chat-a despite cap 4
    expect(reads()).toBe(3)
    getMessages(deps, "chat-a")
    expect(reads()).toBe(4)
  })

  test("does not cache a transcript that individually exceeds the byte budget", () => {
    const files = new Map([transcriptFile("chat-a")])
    const { storage, reads } = countingStorage(files)
    // 1-byte budget: every real transcript exceeds it and must not be pinned.
    const deps = makeDeps({ storage, transcriptCache: new TranscriptCache(4, 1) })

    getMessages(deps, "chat-a")
    getMessages(deps, "chat-a") // not cached: degrades to disk re-reads, not a memory pin
    expect(reads()).toBe(2)
  })

  test("appended entries count toward the byte budget", () => {
    const cache = new TranscriptCache(4, 400)
    const files = new Map([transcriptFile("chat-a"), transcriptFile("chat-b")])
    const { storage, reads } = countingStorage(files)
    const deps = makeDeps({ storage, transcriptCache: cache })

    getMessages(deps, "chat-a")
    getMessages(deps, "chat-b")
    expect(reads()).toBe(2)

    cache.appendTo("chat-b", { _id: "big", createdAt: 3, kind: "assistant_text", text: "x".repeat(300) })

    getMessages(deps, "chat-a") // chat-a evicted by chat-b's growth
    expect(reads()).toBe(3)
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

  test("evicts the sole cached entry when it grows past the byte budget via appendTo", () => {
    // The size>1 guard kept an oversized entry in the cache permanently, pinning
    // 524 MB RSS for a 96 MB transcript. The guard is removed: once a solo entry
    // exceeds the budget it is evicted and subsequent reads use the tail path,
    // which costs only a small chunk read rather than the full ~524 MB spike.
    const files = new Map([transcriptFile("chat-a")])
    const { storage, reads } = countingStorage(files)
    const cache = new TranscriptCache(4, 200)
    const deps = makeDeps({ storage, transcriptCache: cache })

    getMessages(deps, "chat-a")
    expect(reads()).toBe(1)

    cache.appendTo("chat-a", makeTranscriptEntry("chat-a", "assistant_text", { _id: "big", text: "x".repeat(100) }))

    expect(cache.has("chat-a")).toBe(false)
    getMessages(deps, "chat-a")
    expect(reads()).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Tail-read fast path (byte-offset cursors)
// ---------------------------------------------------------------------------

function makeSliceStorage(content: string): StorageBackend {
  const buf = Buffer.from(content, "utf8")
  const base = makeStorage(new Map([["/data/transcripts/chat-t.jsonl", content]]))
  return {
    ...base,
    sizeSync: () => buf.length,
    readSliceSync: (_p, start, end) => Uint8Array.prototype.slice.call(buf, start, end),
  }
}

function entryLine(i: number, text?: string): string {
  return JSON.stringify({ _id: `e-${i}`, createdAt: i, kind: "assistant_text", text: text ?? `msg ${i} ${"x".repeat(40)}` })
}

function fileOf(count: number): string {
  return `${Array.from({ length: count }, (_v, i) => entryLine(i)).join("\n")  }\n`
}

describe("transcript tail-read", () => {
  test("readTranscriptTail with small chunk grows until minEntries+1 without reading whole file", () => {
    const content = fileOf(50)
    const deps = makeDeps({ storage: makeSliceStorage(content) })
    const tail = readTranscriptTail(deps, "chat-t", 5, undefined, 128)
    expect(tail).not.toBeNull()
    expect(tail!.reachedStart).toBe(false)
    expect(tail!.entries.length).toBeGreaterThan(5)
    const first = tail!.entries[0]!
    // firstLineByteOffset points at the raw line of the first parsed entry
    const at = Buffer.from(content, "utf8").subarray(tail!.lineOffsets[0]!).toString("utf8")
    expect(at.startsWith(JSON.stringify({ _id: first._id, createdAt: first.createdAt, kind: "assistant_text", text: (first as { text: string }).text }).slice(0, 20))).toBe(true)
  })

  test("cold getRecentMessagesPage on a small file equals warm page and fills the cache", () => {
    const content = fileOf(10)
    const cache = new TranscriptCache(4)
    const deps = makeDeps({ storage: makeSliceStorage(content), transcriptCache: cache })
    const coldPage = getRecentMessagesPage(deps, "chat-t", 4)
    expect(cache.has("chat-t")).toBe(true)
    const warmPage = getRecentMessagesPage(deps, "chat-t", 4)
    expect(coldPage.messages.map((m) => m._id)).toEqual(warmPage.messages.map((m) => m._id))
    expect(coldPage.hasOlder).toBe(true)
  })

  test("byte-cursor paging walks the whole transcript without a full load", () => {
    const content = fileOf(23)
    const cache = new TranscriptCache(4)
    const deps = makeDeps({ storage: makeSliceStorage(content), transcriptCache: cache })

    const pages: string[][] = []
    const page = getRecentMessagesPageTail(deps, "chat-t", 5, 64)
    expect(page).not.toBeNull()
    pages.unshift(page!.messages.map((m) => m._id))
    let cursor = page!.olderCursor
    let guard = 0
    while (cursor !== null && guard++ < 20) {
      const older = getMessagesPageBefore(deps, "chat-t", cursor, 5)
      pages.unshift(older.messages.map((m) => m._id))
      cursor = older.olderCursor
    }
    const all = pages.flat()
    expect(all).toEqual(Array.from({ length: 23 }, (_v, i) => `e-${i}`))
    expect(cache.has("chat-t")).toBe(false)
  })

  test("multibyte content across chunk boundaries parses correctly", () => {
    const lines = Array.from({ length: 30 }, (_v, i) => entryLine(i, `emoji 🌸🌸🌸 ${i} ${"火水木金土".repeat(6)}`))
    const content = `${lines.join("\n")  }\n`
    const deps = makeDeps({ storage: makeSliceStorage(content) })
    const tail = readTranscriptTail(deps, "chat-t", 8, undefined, 100)
    expect(tail).not.toBeNull()
    for (const entry of tail!.entries) {
      if (entry.kind !== "assistant_text") throw new Error("expected assistant_text")
      expect(entry.text).toContain("🌸🌸🌸")
    }
  })

  test("falls back to full load when storage lacks slice APIs", () => {
    const content = fileOf(6)
    const files = new Map([["/data/transcripts/chat-t.jsonl", content]])
    const cache = new TranscriptCache(4)
    const deps = makeDeps({ storage: makeStorage(files), transcriptCache: cache })
    const page = getRecentMessagesPage(deps, "chat-t", 3)
    expect(page.messages.map((m) => m._id)).toEqual(["e-3", "e-4", "e-5"])
    expect(cache.has("chat-t")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getLatestChatContextWindowUsage — tail-backed proactive-compact trigger
// ---------------------------------------------------------------------------

const TRANSCRIPT_PATH = "/data/transcripts/chat-t.jsonl"

function usageLine(usedTokens: number, maxTokens: number, i: number): string {
  return JSON.stringify({
    _id: `u-${i}`,
    createdAt: i,
    kind: "context_window_updated",
    usage: { usedTokens, maxTokens, compactsAutomatically: false },
  })
}

function boundaryLine(i: number): string {
  return JSON.stringify({ _id: `cb-${i}`, createdAt: i, kind: "compact_boundary" })
}

function linesToFile(lines: string[]): string {
  return `${lines.join("\n")}\n`
}

/**
 * Slice storage that records the span of every byte read. "Did not read the
 * whole file" is the actual claim of this change, and the read spans are the
 * only direct evidence for it.
 */
function makeCountingSliceStorage(content: string): { storage: StorageBackend; spans: number[] } {
  const spans: number[] = []
  const base = makeSliceStorage(content)
  return {
    storage: {
      ...base,
      readSliceSync: (p, start, end) => {
        spans.push(end - start)
        return base.readSliceSync!(p, start, end)
      },
    },
    spans,
  }
}

/** Padding large enough that one 64 KiB window cannot cover the whole file. */
function padding(count: number): string[] {
  return Array.from({ length: count }, (_v, i) => entryLine(i))
}

describe("getLatestChatContextWindowUsage", () => {
  test("finds usage in the last few entries without reading the whole file", () => {
    const content = linesToFile([...padding(1500), usageLine(180_000, 200_000, 9999)])
    const { storage, spans } = makeCountingSliceStorage(content)
    const deps = makeDeps({ storage })

    expect(getLatestChatContextWindowUsage(deps, "chat-t")?.usedTokens).toBe(180_000)
    expect(spans.length).toBe(1)
    expect(spans.reduce((a, b) => a + b, 0)).toBeLessThan(Buffer.byteLength(content, "utf8"))
  })

  test("grows the window when the marker is far from EOF", () => {
    const content = linesToFile([usageLine(180_000, 200_000, 0), ...padding(1500)])
    const { storage, spans } = makeCountingSliceStorage(content)
    const deps = makeDeps({ storage })

    expect(getLatestChatContextWindowUsage(deps, "chat-t")?.usedTokens).toBe(180_000)
    // Pins that growth actually happened rather than one lucky oversized read.
    expect(spans.length).toBeGreaterThan(1)
  })

  test("returns null after reaching BOF when no marker exists anywhere", () => {
    const content = linesToFile(padding(1500))
    const { storage } = makeCountingSliceStorage(content)
    const cache = new TranscriptCache(4)
    const deps = makeDeps({ storage, transcriptCache: cache })

    expect(getLatestChatContextWindowUsage(deps, "chat-t")).toBe(null)
    // Reaching BOF must NOT promote the transcript into the full cache — that
    // would re-introduce the very memory this read exists to avoid.
    expect(cache.has("chat-t")).toBe(false)
  })

  test("a compact_boundary newer than the last usage wins, and stops the scan early", () => {
    const content = linesToFile([
      usageLine(180_000, 200_000, 0),
      ...padding(1500),
      boundaryLine(9999),
    ])
    const { storage, spans } = makeCountingSliceStorage(content)
    const deps = makeDeps({ storage })

    expect(getLatestChatContextWindowUsage(deps, "chat-t")).toBe(null)
    // The perf assertion for the tri-state: a boundary is a CONCLUSIVE null,
    // so the scan must stop at the first window. Treating it as "not found"
    // would walk to BOF on every send for the rest of the chat's life.
    expect(spans.length).toBe(1)
  })

  test("agrees with a full backward scan on randomized transcripts", () => {
    // Seeded LCG — deterministic, no Math.random.
    let seed = 0x2f6e2b1
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let shape = 0; shape < 20; shape += 1) {
      const lines: string[] = []
      for (let i = 0; i < 200; i += 1) {
        const roll = next()
        if (roll < 0.1) lines.push(usageLine(100_000 + i, 200_000, i))
        else if (roll < 0.15) lines.push(boundaryLine(i))
        else lines.push(entryLine(i))
      }
      const content = linesToFile(lines)
      const deps = makeDeps({ storage: makeSliceStorage(content), transcriptCache: new TranscriptCache(4) })
      const full = makeDeps({ storage: makeSliceStorage(content), transcriptCache: new TranscriptCache(4) })

      expect(getLatestChatContextWindowUsage(deps, "chat-t")).toEqual(
        getLatestContextWindowUsage(loadTranscriptFromDisk(full, "chat-t")),
      )
    }
  })

  test("falls back to the full load on a backend without byte-slice APIs", () => {
    const content = linesToFile([...padding(50), usageLine(180_000, 200_000, 9999)])
    const deps = makeDeps({ storage: makeStorage(new Map([[TRANSCRIPT_PATH, content]])) })

    expect(getLatestChatContextWindowUsage(deps, "chat-t")?.usedTokens).toBe(180_000)
  })

  test("uses the cached transcript when one is present, without touching storage", () => {
    const cache = new TranscriptCache(4)
    cache.set("chat-t", [
      JSON.parse(usageLine(90_000, 200_000, 1)) as TranscriptEntry,
    ])
    const base = makeSliceStorage(linesToFile(padding(10)))
    const deps = makeDeps({
      transcriptCache: cache,
      storage: {
        ...base,
        readSliceSync: () => { throw new Error("must not read from disk when cached") },
        readTextSync: () => { throw new Error("must not read from disk when cached") },
      },
    })

    expect(getLatestChatContextWindowUsage(deps, "chat-t")?.usedTokens).toBe(90_000)
  })

  test("reads legacy in-memory messages that have no file on disk", () => {
    // A legacy chat has no transcript file at all, so a tail read would see an
    // empty transcript and wrongly report "no usage", silently disabling the
    // proactive compact for it.
    const deps = makeDeps({
      storage: makeSliceStorage(""),
      legacyMessagesByChatId: new Map([
        ["chat-t", [JSON.parse(usageLine(120_000, 200_000, 1)) as TranscriptEntry]],
      ]),
    })

    expect(getLatestChatContextWindowUsage(deps, "chat-t")?.usedTokens).toBe(120_000)
  })

  test("returns null for a chat with no transcript at all", () => {
    const deps = makeDeps({ storage: makeSliceStorage("") })
    expect(getLatestChatContextWindowUsage(deps, "chat-unknown")).toBe(null)
  })

  test("reads each byte at most once when no marker exists", () => {
    // Non-overlapping windows are what keep the marker-less case — MEASURED as
    // 241 of 264 chats on the reference install — cheaper than a flat read.
    // Re-reading from EOF with a growing window costs ~2x the file instead.
    const content = linesToFile(padding(4000))
    const fileBytes = Buffer.byteLength(content, "utf8")
    const { storage, spans } = makeCountingSliceStorage(content)
    const deps = makeDeps({ storage })

    expect(getLatestChatContextWindowUsage(deps, "chat-t")).toBe(null)
    // A little slack for the torn leading line each window re-covers.
    expect(spans.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(fileBytes * 1.1)
  })

  test("stops looking past the lookback bound and reports no current usage", () => {
    // A marker further back than one turn's worth of entries describes a
    // context window that has since been fully replaced, so `null` (no
    // proactive compact) is the correct answer rather than a stale reading.
    const farBack = [
      usageLine(180_000, 200_000, 0),
      ...padding(200_000), // pushes the marker well past 8 MiB from EOF
    ]
    const content = linesToFile(farBack)
    expect(Buffer.byteLength(content, "utf8")).toBeGreaterThan(8 * 1024 * 1024)
    const { storage, spans } = makeCountingSliceStorage(content)
    const deps = makeDeps({ storage })

    expect(getLatestChatContextWindowUsage(deps, "chat-t")).toBe(null)
    expect(spans.reduce((a, b) => a + b, 0)).toBeLessThan(9 * 1024 * 1024)
  })
})

// ---------------------------------------------------------------------------
// getRecentRawEntries
// ---------------------------------------------------------------------------

describe("getRecentRawEntries", () => {
  function makeSliceStorage(content: string): StorageBackend {
    const buf = Buffer.from(content, "utf8")
    return {
      mkdir: async () => {},
      exists: async (p) => p.endsWith(".jsonl"),
      existsSync: (p) => p.endsWith(".jsonl"),
      size: async () => buf.length,
      sizeSync: () => buf.length,
      readText: async () => content,
      readTextSync: () => content,
      writeText: async () => {},
      appendText: async () => {},
      rename: async () => {},
      remove: async () => {},
      readSliceSync: (_p: string, start: number, end: number) => buf.subarray(start, end),
    }
  }

  function lines(count: number): string {
    return Array.from({ length: count }, (_, i) =>
      JSON.stringify({ _id: `e${i}`, createdAt: i, kind: "assistant_text", text: `t${i}` })
    ).join("\n").concat("\n")
  }

  test("returns all entries when transcript is smaller than limit", () => {
    const content = lines(5)
    const deps = makeDeps({ storage: makeSliceStorage(content) })
    const result = getRecentRawEntries(deps, "chat-1", 100)
    expect(result.length).toBe(5)
    expect(result[0]._id).toBe("e0")
    expect(result[4]._id).toBe("e4")
  })

  test("returns only the last `limit` entries for a large transcript", () => {
    const content = lines(200)
    const deps = makeDeps({ storage: makeSliceStorage(content) })
    const result = getRecentRawEntries(deps, "chat-1", 10)
    expect(result.length).toBe(10)
    expect(result[result.length - 1]._id).toBe("e199")
  })

  test("serves from full-transcript cache when available", () => {
    const cache = new TranscriptCache()
    const cached: TranscriptEntry[] = [
      { _id: "c0", createdAt: 0, kind: "user_prompt", content: "hi" } as TranscriptEntry,
      { _id: "c1", createdAt: 1, kind: "assistant_text", text: "yo" } as TranscriptEntry,
    ]
    cache.set("chat-1", cached, 50)
    const deps = makeDeps({ storage: makeSliceStorage(""), transcriptCache: cache })
    const result = getRecentRawEntries(deps, "chat-1", 10)
    expect(result.length).toBe(2)
    expect(result[0]._id).toBe("c0")
  })
})

// ---------------------------------------------------------------------------
// TranscriptCache.isSeeded / markSeeded — seeding state independent of LRU
// ---------------------------------------------------------------------------

describe("TranscriptCache isSeeded / markSeeded", () => {
  test("isSeeded returns false for an unknown chatId", () => {
    const cache = new TranscriptCache()
    expect(cache.isSeeded("chat-x")).toBe(false)
  })

  test("isSeeded returns true after markSeeded", () => {
    const cache = new TranscriptCache()
    cache.markSeeded("chat-1")
    expect(cache.isSeeded("chat-1")).toBe(true)
  })

  test("isSeeded returns true when transcript is in the LRU cache", () => {
    const cache = new TranscriptCache()
    const e = makeTranscriptEntry()
    cache.set("chat-1", [e], 50)
    expect(cache.isSeeded("chat-1")).toBe(true)
  })

  test("isSeeded returns false for a different chatId after markSeeded on another", () => {
    const cache = new TranscriptCache()
    cache.markSeeded("chat-1")
    expect(cache.isSeeded("chat-2")).toBe(false)
  })

  test("invalidate clears the seeded flag", () => {
    const cache = new TranscriptCache()
    cache.markSeeded("chat-1")
    cache.invalidate("chat-1")
    expect(cache.isSeeded("chat-1")).toBe(false)
  })

  test("invalidateAll clears all seeded flags", () => {
    const cache = new TranscriptCache()
    cache.markSeeded("chat-1")
    cache.markSeeded("chat-2")
    cache.invalidateAll()
    expect(cache.isSeeded("chat-1")).toBe(false)
    expect(cache.isSeeded("chat-2")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getMessagesView — marks oversized transcripts as seeded without caching them
// ---------------------------------------------------------------------------

describe("getMessagesView seeding for oversized transcripts", () => {
  test("marks chat as seeded after disk load even when transcript exceeds maxBytes", () => {
    const e1 = makeTranscriptEntry("chat-1")
    const content = `${JSON.stringify(e1)}\n`
    const files = new Map([["/data/transcripts/chat-1.jsonl", content]])
    const transcriptCache = new TranscriptCache(4, 10)
    const deps = makeDeps({ storage: makeStorage(files), transcriptCache })

    expect(transcriptCache.isSeeded("chat-1")).toBe(false)
    getMessagesView(deps, "chat-1")

    expect(transcriptCache.isSeeded("chat-1")).toBe(true)
    expect(transcriptCache.has("chat-1")).toBe(false)
  })

  test("isSeeded guard prevents repeated disk reads (simulates ensureTranscriptLoaded fix)", () => {
    let readCount = 0
    const e1 = makeTranscriptEntry("chat-1")
    const content = `${JSON.stringify(e1)}\n`
    const files = new Map([["/data/transcripts/chat-1.jsonl", content]])
    const spyStorage: StorageBackend = {
      ...makeStorage(files),
      readTextSync: (p) => {
        readCount += 1
        return files.get(p) ?? ""
      },
    }
    const transcriptCache = new TranscriptCache(4, 10)
    const deps = makeDeps({ storage: spyStorage, transcriptCache })

    const ensureTranscriptLoaded = () => {
      if (!transcriptCache.isSeeded("chat-1")) {
        getMessagesView(deps, "chat-1")
      }
    }

    ensureTranscriptLoaded()
    expect(readCount).toBe(1)

    ensureTranscriptLoaded()
    ensureTranscriptLoaded()
    expect(readCount).toBe(1)
  })
})
