import { beforeEach, describe, expect, test } from "bun:test"
import type { InboxActivityItem, InboxSnapshot, InboxThread } from "../../shared/inbox/types"
import { selectInboxItems, selectInboxThreads, selectSelectedThread, useInboxStore } from "./inboxStore"

function thread(id: string, lastMessageAt: number): InboxThread {
  return {
    id,
    sourceKind: "webhook",
    sourceId: "h",
    sourceName: "CI",
    threadKey: id,
    sender: "ada",
    messages: [],
    state: "needs_you",
    unread: true,
    lastMessageAt,
    replyCount: 0,
  }
}

function item(id: string, ts: number): InboxActivityItem {
  return {
    id,
    ts,
    subject: "kanna.turn.finished",
    source: { kind: "store", log: "turns" },
    title: "Turn finished",
    preview: "",
    payload: {},
    attention: false,
    unread: false,
  }
}

function snapshot(threads: InboxThread[], items: InboxActivityItem[], unreadCount = 0): InboxSnapshot {
  return { threads, items, unreadCount, total: threads.length + items.length }
}

beforeEach(() => {
  useInboxStore.setState(useInboxStore.getInitialState())
})

describe("applySnapshot", () => {
  test("an empty snapshot keeps the shared empty references so selectors do not re-render", () => {
    const before = useInboxStore.getState()
    useInboxStore.getState().applySnapshot(snapshot([], []))
    const after = useInboxStore.getState()
    expect(selectInboxThreads(after)).toBe(selectInboxThreads(before))
    expect(selectInboxItems(after)).toBe(selectInboxItems(before))
  })

  test("a snapshot replaces recent records but keeps older pages already loaded", () => {
    useInboxStore.getState().applySnapshot(snapshot([thread("t2", 200), thread("t1", 100)], []))
    useInboxStore.getState().appendPage({ threads: [thread("t0", 50)], items: [item("i0", 40)] })
    useInboxStore.getState().applySnapshot(snapshot([thread("t3", 300), thread("t2", 200), thread("t1", 100)], [], 2))
    const state = useInboxStore.getState()
    expect(state.threads.map((entry) => entry.id)).toEqual(["t3", "t2", "t1", "t0"])
    expect(state.unreadCount).toBe(2)
  })
})

describe("appendPage", () => {
  test("marks the history exhausted when a page is empty and a new filter re-opens it", () => {
    useInboxStore.getState().appendPage({ threads: [], items: [] })
    expect(useInboxStore.getState().olderExhausted).toBe(true)
    useInboxStore.getState().setFilter({ attentionOnly: true })
    expect(useInboxStore.getState().olderExhausted).toBe(false)
  })
})

describe("selection and drafts", () => {
  test("selects a thread by id and resolves it from the loaded threads", () => {
    useInboxStore.getState().applySnapshot(snapshot([thread("t1", 100)], []))
    useInboxStore.getState().select("t1")
    expect(selectSelectedThread(useInboxStore.getState())?.id).toBe("t1")
    useInboxStore.getState().select("gone")
    expect(selectSelectedThread(useInboxStore.getState())).toBeNull()
  })

  test("toggling raw twice returns to the shared empty reference", () => {
    const initial = useInboxStore.getState().rawOpen
    useInboxStore.getState().toggleRaw("m1")
    expect(useInboxStore.getState().rawOpen.m1).toBe(true)
    useInboxStore.getState().toggleRaw("m1")
    expect(useInboxStore.getState().rawOpen).toBe(initial)
  })

  test("clearing a draft records an explicit empty draft so the agent seed does not return", () => {
    useInboxStore.getState().setReplyDraft("t1", "hello")
    expect(useInboxStore.getState().replyDrafts.t1).toBe("hello")
    useInboxStore.getState().clearReplyDraft("t1")
    expect(useInboxStore.getState().replyDrafts.t1).toBe("")
  })
})
