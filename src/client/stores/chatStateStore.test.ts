import { beforeEach, describe, expect, test } from "bun:test"
import { useChatStateStore, selectChatSlice, EMPTY_CHAT_SLICE } from "./chatStateStore"
import type { ChatOpsEvent } from "../../shared/chat-ops"
import type { ChatRuntime, ChatSnapshot, TranscriptEntry } from "../../shared/types"

function makeRuntime(chatId: string): ChatRuntime {
  return {
    chatId,
    projectId: "project-1",
    localPath: "/tmp/p",
    title: "Chat",
    status: "idle",
    isDraining: false,
    provider: "claude",
    planMode: false,
    sessionTokensByProvider: {},
    timings: {
      activeSessionStartedAt: 0,
      chatCreatedAt: 0,
      stateEnteredAt: 0,
      lastTurnDurationMs: null,
      derivedAtMs: 0,
      cumulativeMs: { idle: 0, starting: 0, running: 0, waiting_for_user: 0, failed: 0 },
    },
    policyOverride: null,
    sessionState: "cold",
    backgroundTasks: [],
  }
}

function textEntry(id: string): TranscriptEntry {
  return { _id: id, createdAt: 1, kind: "assistant_text", text: id }
}

function makeSnapshot(chatId: string, seq: number): ChatSnapshot {
  return {
    runtime: makeRuntime(chatId),
    queuedMessages: [],
    messages: [textEntry("a")],
    history: { hasOlder: false, olderCursor: null, recentLimit: 200 },
    availableProviders: [],
    schedules: {},
    liveScheduleId: null,
    tunnels: {},
    liveTunnelId: null,
    subagentRuns: {},
    loopProgress: { chatId, armed: false, rows: [], rateLimit: null },
    cronJobs: [],
    seq,
  }
}

function opsEvent(chatId: string, fromSeq: number, toSeq: number): ChatOpsEvent {
  return {
    type: "chat.ops",
    chatId,
    fromSeq,
    toSeq,
    ops: [{ kind: "entries.append", entries: [textEntry(`e-${toSeq}`)] }],
  }
}

describe("chatStateStore", () => {
  beforeEach(() => {
    // Reset to empty state before each test
    useChatStateStore.setState({ chats: {}, optimisticProcessing: {} })
  })

  // ─── mandatory test 1: isolation ────────────────────────────────────────────
  test("updating chatA does not affect chatB slice reference", () => {
    useChatStateStore.getState().setChatSnapshot("chatB", makeSnapshot("chatB", 1))
    const sliceB = selectChatSlice(useChatStateStore.getState(), "chatB")

    useChatStateStore.getState().setChatSnapshot("chatA", makeSnapshot("chatA", 1))

    expect(selectChatSlice(useChatStateStore.getState(), "chatB")).toBe(sliceB)
  })

  // ─── mandatory test 2: releaseChat ──────────────────────────────────────────
  test("releaseChat removes chatA while chatB remains", () => {
    useChatStateStore.getState().setChatSnapshot("chatA", makeSnapshot("chatA", 1))
    useChatStateStore.getState().setChatSnapshot("chatB", makeSnapshot("chatB", 1))

    useChatStateStore.getState().releaseChat("chatA")

    expect("chatA" in useChatStateStore.getState().chats).toBe(false)
    expect("chatB" in useChatStateStore.getState().chats).toBe(true)
  })

  // ─── mandatory test 3: selectChatSlice stable ref for nonexistent chat ──────
  test("selectChatSlice returns the same EMPTY_CHAT_SLICE reference for unknown chatId", () => {
    const a = selectChatSlice(useChatStateStore.getState(), "does-not-exist")
    const b = selectChatSlice(useChatStateStore.getState(), "also-missing")
    expect(a).toBe(EMPTY_CHAT_SLICE)
    expect(b).toBe(EMPTY_CHAT_SLICE)
  })

  // ─── applyChatOpsEvent (migrated from kannaStateStore.test.ts) ──────────────
  describe("applyChatOpsEvent", () => {
    beforeEach(() => {
      useChatStateStore.getState().setChatSnapshot("chat-1", makeSnapshot("chat-1", 5))
    })

    test("applies a contiguous ops event", () => {
      const result = useChatStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-1", 6, 6))
      expect(result).toBe("applied")
      const snapshot = selectChatSlice(useChatStateStore.getState(), "chat-1").chatSnapshot
      expect(snapshot?.seq).toBe(6)
      expect(snapshot?.messages.map((m) => m._id)).toEqual(["a", "e-6"])
    })

    test("keeps untouched entry references stable", () => {
      const before = selectChatSlice(useChatStateStore.getState(), "chat-1").chatSnapshot!.messages[0]
      useChatStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-1", 6, 6))
      expect(selectChatSlice(useChatStateStore.getState(), "chat-1").chatSnapshot!.messages[0]).toBe(before!)
    })

    test("returns gap for non-contiguous event without mutating state", () => {
      const before = selectChatSlice(useChatStateStore.getState(), "chat-1").chatSnapshot
      const result = useChatStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-1", 8, 8))
      expect(result).toBe("gap")
      expect(selectChatSlice(useChatStateStore.getState(), "chat-1").chatSnapshot).toBe(before)
    })

    test("returns stale for already-covered event", () => {
      const before = selectChatSlice(useChatStateStore.getState(), "chat-1").chatSnapshot
      const result = useChatStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-1", 4, 4))
      expect(result).toBe("stale")
      expect(selectChatSlice(useChatStateStore.getState(), "chat-1").chatSnapshot).toBe(before)
    })

    test("ignores events for a different chat", () => {
      const before = selectChatSlice(useChatStateStore.getState(), "chat-1").chatSnapshot
      const result = useChatStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-2", 6, 6))
      expect(result).toBe("stale")
      expect(selectChatSlice(useChatStateStore.getState(), "chat-1").chatSnapshot).toBe(before)
    })

    test("returns gap when snapshot has no seq (ops unsupported baseline)", () => {
      const noSeq = { ...makeSnapshot("chat-1", 0) }
      delete noSeq.seq
      useChatStateStore.getState().setChatSnapshot("chat-1", noSeq)
      const result = useChatStateStore.getState().applyChatOpsEvent("chat-1", opsEvent("chat-1", 1, 1))
      expect(result).toBe("gap")
    })

    test("bumpChatResyncNonce increments for the named chat only", () => {
      useChatStateStore.getState().setChatSnapshot("chat-2", makeSnapshot("chat-2", 1))
      const before1 = selectChatSlice(useChatStateStore.getState(), "chat-1").chatResyncNonce
      const before2 = selectChatSlice(useChatStateStore.getState(), "chat-2").chatResyncNonce
      useChatStateStore.getState().bumpChatResyncNonce("chat-1")
      expect(selectChatSlice(useChatStateStore.getState(), "chat-1").chatResyncNonce).toBe(before1 + 1)
      expect(selectChatSlice(useChatStateStore.getState(), "chat-2").chatResyncNonce).toBe(before2)
    })
  })

  // ─── adoptServerHistory: the scrollback bookmark ────────────────────────────
  describe("adoptServerHistory", () => {
    test("adopts the snapshot bookmark before the user has paged back", () => {
      useChatStateStore.getState().adoptServerHistory("chat-1", {
        olderCursor: "byte:14350553",
        hasOlder: true,
      })

      const slice = selectChatSlice(useChatStateStore.getState(), "chat-1")
      expect(slice.historyCursor).toBe("byte:14350553")
      expect(slice.hasOlderHistory).toBe(true)
    })

    test("keeps the scrolled-back cursor when a later snapshot arrives", () => {
      const store = useChatStateStore.getState()
      // Cold open: adopt the newest page's bookmark.
      store.adoptServerHistory("chat-1", { olderCursor: "byte:14350553", hasOlder: true })
      // User scrolls up once: a page merges in and the bookmark advances backwards.
      store.setOlderHistoryEntries("chat-1", [textEntry("older-1")])
      store.setHistoryCursor("chat-1", "byte:13608529")

      // A full snapshot push (ring gap / reconnect) re-ships the NEWEST page's
      // bookmark — adopting it would rewind scrollback to the bottom.
      store.adoptServerHistory("chat-1", { olderCursor: "byte:14350553", hasOlder: true })

      const slice = selectChatSlice(useChatStateStore.getState(), "chat-1")
      expect(slice.historyCursor).toBe("byte:13608529")
    })

    test("does not re-arm hasOlder after the user has paged to the beginning", () => {
      const store = useChatStateStore.getState()
      store.setOlderHistoryEntries("chat-1", [textEntry("older-1")])
      store.setHistoryCursor("chat-1", null)
      store.setHasOlderHistory("chat-1", false)

      store.adoptServerHistory("chat-1", { olderCursor: "byte:14350553", hasOlder: true })

      const slice = selectChatSlice(useChatStateStore.getState(), "chat-1")
      expect(slice.hasOlderHistory).toBe(false)
      expect(slice.historyCursor).toBeNull()
    })

    test("adopts again once the older entries are cleared (chat switch)", () => {
      const store = useChatStateStore.getState()
      store.setOlderHistoryEntries("chat-1", [textEntry("older-1")])
      store.setHistoryCursor("chat-1", "byte:13608529")

      store.setOlderHistoryEntries("chat-1", [])
      store.adoptServerHistory("chat-1", { olderCursor: "byte:14350553", hasOlder: true })

      expect(selectChatSlice(useChatStateStore.getState(), "chat-1").historyCursor).toBe("byte:14350553")
    })

    test("leaves the slice reference untouched when it declines to adopt", () => {
      const store = useChatStateStore.getState()
      store.setOlderHistoryEntries("chat-1", [textEntry("older-1")])
      const before = selectChatSlice(useChatStateStore.getState(), "chat-1")

      store.adoptServerHistory("chat-1", { olderCursor: "byte:14350553", hasOlder: true })

      expect(selectChatSlice(useChatStateStore.getState(), "chat-1")).toBe(before)
    })
  })
})
