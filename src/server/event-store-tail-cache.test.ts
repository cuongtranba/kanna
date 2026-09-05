import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import type { TranscriptEntry } from "../shared/types"
import { getRecentMessagesPageTail, MAX_SEEN_MESSAGE_IDS } from "./event-store-messages.adapter"

function entry(id: string, text: string): TranscriptEntry {
  return { _id: id, createdAt: Date.now(), kind: "assistant_text", text } as TranscriptEntry
}

async function withStore(fn: (store: EventStore, chatId: string) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-tailcache-"))
  try {
    const store = new EventStore(dir)
    await store.initialize()
    const project = await store.openProject("/tmp/tail-cache-project")
    const chat = await store.createChat(project.id)
    await fn(store, chat.id)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const lastText = (store: EventStore, chatId: string) => {
  const page = store.getRecentChatHistory(chatId, 200)
  const last = page.messages[page.messages.length - 1] as { text?: string } | undefined
  return last?.text
}

describe("transcript tail cache", () => {
  test("a newly appended message is visible immediately after a cached read", async () => {
    await withStore(async (store, chatId) => {
      for (let i = 0; i < 400; i += 1) {
        await store.appendMessage(chatId, entry(`e${i}`, `body ${i} ${"x".repeat(2000)}`))
      }
      await store.flush()

      expect(lastText(store, chatId)).toContain("body 399")
      store.getRecentChatHistory(chatId, 200)
      await store.appendMessage(chatId, entry("fresh", "THE NEW ONE"))
      await store.flush()

      expect(lastText(store, chatId)).toBe("THE NEW ONE")
    })
  })

  test("repeated reads with no writes stay consistent", async () => {
    await withStore(async (store, chatId) => {
      for (let i = 0; i < 400; i += 1) {
        await store.appendMessage(chatId, entry(`e${i}`, `body ${i} ${"x".repeat(2000)}`))
      }
      await store.flush()

      const first = store.getRecentChatHistory(chatId, 200)
      for (let i = 0; i < 5; i += 1) {
        const again = store.getRecentChatHistory(chatId, 200)
        expect(again.messages.length).toBe(first.messages.length)
        expect(again.history.hasOlder).toBe(first.history.hasOlder)
        expect(again.history.olderCursor).toBeTruthy()
      }
    })
  })

  test("every appended message is still reachable by paging back", async () => {
    await withStore(async (store, chatId) => {
      const total = 400
      for (let i = 0; i < total; i += 1) {
        await store.appendMessage(chatId, entry(`e${i}`, `body ${i} ${"x".repeat(2000)}`))
      }
      await store.flush()

      const first = store.getRecentChatHistory(chatId, 200)
      let reached = first.messages.length
      let cursor = first.history.olderCursor
      let hasOlder = first.history.hasOlder
      let pages = 0

      while (hasOlder && cursor && pages < 100) {
        const page = store.getMessagesPageBefore(chatId, cursor, 200)
        pages += 1
        if (page.messages.length === 0) break
        reached += page.messages.length
        cursor = page.olderCursor
        hasOlder = page.hasOlder
      }

      expect(pages).toBeGreaterThan(0)
      expect(reached).toBe(total)
    })
  })

  test("a different recentLimit is not served from another limit's window", async () => {
    await withStore(async (store, chatId) => {
      for (let i = 0; i < 400; i += 1) {
        await store.appendMessage(chatId, entry(`e${i}`, `body ${i} ${"x".repeat(2000)}`))
      }
      await store.flush()

      const wide = store.getRecentChatHistory(chatId, 200)
      const narrow = store.getRecentChatHistory(chatId, 10)
      expect(narrow.messages.length).toBeLessThan(wide.messages.length)
      expect(narrow.messages.length).toBe(10)
    })
  })
})

describe("byte-aware tail growth", () => {
  test("serves an identical page regardless of chunk size", async () => {
    await withStore(async (store, chatId) => {
      for (let i = 0; i < 300; i += 1) {
        await store.appendMessage(chatId, entry(`e${i}`, `body ${i} ${"x".repeat(20_000)}`))
      }
      await store.flush()

      type Deps = Parameters<typeof getRecentMessagesPageTail>[0]
      const deps = (store as unknown as { msgReadDeps: Deps }).msgReadDeps
      const cache = (deps as unknown as { transcriptCache: { invalidateTail: (id: string) => void } })
        .transcriptCache

      const pages = [4 * 1024, 64 * 1024, 256 * 1024, 8 * 1024 * 1024].map((chunk) => {
        cache.invalidateTail(chatId)
        return JSON.stringify(getRecentMessagesPageTail(deps, chatId, 200, chunk))
      })

      for (const page of pages) expect(page).toBe(pages[0])
      const parsed = JSON.parse(pages[0]!) as { messages: unknown[] }
      expect(parsed.messages.length).toBeLessThan(200)
      expect(parsed.messages.length).toBeGreaterThanOrEqual(10)
    })
  })

  test("a chat under the budget still returns every entry it has", async () => {
    await withStore(async (store, chatId) => {
      for (let i = 0; i < 40; i += 1) {
        await store.appendMessage(chatId, entry(`e${i}`, `small ${i}`))
      }
      await store.flush()
      const page = store.getRecentChatHistory(chatId, 200)
      expect(page.messages.length).toBe(40)
      expect(page.history.hasOlder).toBe(false)
    })
  })
})

describe("seenMessageIds Set is bounded", () => {
  type StoreInternals = { seenMessageIdsByChatId: Map<string, Set<string>> }

  function entryWithId(id: string, mid: string): TranscriptEntry {
    return { _id: id, createdAt: Date.now(), kind: "assistant_text", text: "x", messageId: mid } as TranscriptEntry
  }

  test("seenMessageIds does not exceed MAX_SEEN_MESSAGE_IDS after many appends", async () => {
    await withStore(async (store, chatId) => {
      const overCap = MAX_SEEN_MESSAGE_IDS + 100
      for (let i = 0; i < overCap; i += 1) {
        await store.appendMessage(chatId, entryWithId(`e${i}`, `mid-${i}`))
      }

      const seen = (store as unknown as StoreInternals).seenMessageIdsByChatId.get(chatId)!
      expect(seen.size).toBeLessThanOrEqual(MAX_SEEN_MESSAGE_IDS)
      expect(seen.has(`mid-${overCap - 1}`)).toBe(true)
      expect(seen.has("mid-0")).toBe(false)
    })
  })

  test("dedup still prevents duplicate messageIds after eviction", async () => {
    await withStore(async (store, chatId) => {
      for (let i = 0; i < MAX_SEEN_MESSAGE_IDS + 50; i += 1) {
        await store.appendMessage(chatId, entryWithId(`e${i}`, `mid-${i}`))
      }
      const recentMid = `mid-${MAX_SEEN_MESSAGE_IDS + 49}`
      const countBefore = (store as unknown as StoreInternals).seenMessageIdsByChatId.get(chatId)!.size
      await store.appendMessage(chatId, entryWithId("duplicate", recentMid))
      const countAfter = (store as unknown as StoreInternals).seenMessageIdsByChatId.get(chatId)!.size
      expect(countAfter).toBe(countBefore)
    })
  })
})
