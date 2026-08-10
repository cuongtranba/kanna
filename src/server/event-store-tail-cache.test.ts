import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import type { TranscriptEntry } from "../shared/types"
import { getRecentMessagesPageTail } from "./event-store-messages.adapter"

/**
 * The tail window is cached against the transcript's BYTE SIZE, which is only
 * a sound validity token while the JSONL is append-only. These tests pin the
 * consequence that actually matters: a cached window must never hide a message
 * that has since been appended.
 */
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
      // Enough entries that the tail read never reaches the start, which is
      // exactly the case where the full-transcript cache stays empty and the
      // tail cache is the only thing standing between us and a re-parse.
      for (let i = 0; i < 400; i += 1) {
        await store.appendMessage(chatId, entry(`e${i}`, `body ${i} ${"x".repeat(2000)}`))
      }
      await store.flush()

      expect(lastText(store, chatId)).toContain("body 399")
      // Prime the cache, then append and read again.
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
        // Deliberately NOT asserting cursor equality across reads. Pre-existing
        // behaviour (not introduced by the tail cache): when a transcript fits
        // in one 256 KB tail chunk, the first read seeds the full-transcript
        // cache and later reads take the array path, so the cursor flips from
        // `byte:<offset>` to `idx:<n>`. Both decode correctly, so the contract
        // is "a cursor that pages back", not "a stable cursor string".
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

/**
 * The tail read grows its slice until it has enough entries OR enough bytes to
 * fill the byte budget. That early stop is a pure cost optimization: it must
 * never change the page that is served. Varying the chunk size changes how
 * many growth steps happen and where the loop stops, so a page that is
 * identical across chunk sizes is evidence the stop condition is not
 * observable from outside.
 */
describe("byte-aware tail growth", () => {
  test("serves an identical page regardless of chunk size", async () => {
    await withStore(async (store, chatId) => {
      // Fat entries, so 200 of them far exceed the byte budget and the growth
      // loop actually has a decision to make.
      for (let i = 0; i < 300; i += 1) {
        await store.appendMessage(chatId, entry(`e${i}`, `body ${i} ${"x".repeat(20_000)}`))
      }
      await store.flush()

      // Drive the tail read DIRECTLY so chunkBytes actually varies — going
      // through getRecentChatHistory would ignore it and make this tautological.
      type Deps = Parameters<typeof getRecentMessagesPageTail>[0]
      const deps = (store as unknown as { buildMessageReadDeps: () => Deps })
        .buildMessageReadDeps()
      const cache = (deps as unknown as { transcriptCache: { invalidateTail: (id: string) => void } })
        .transcriptCache

      const pages = [4 * 1024, 64 * 1024, 256 * 1024, 8 * 1024 * 1024].map((chunk) => {
        cache.invalidateTail(chatId)
        return JSON.stringify(getRecentMessagesPageTail(deps, chatId, 200, chunk))
      })

      for (const page of pages) expect(page).toBe(pages[0])
      const parsed = JSON.parse(pages[0]!) as { messages: unknown[] }
      // Bounded by bytes, so well under the 200 asked for, and over the floor.
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
