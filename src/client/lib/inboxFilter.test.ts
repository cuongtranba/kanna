import { describe, expect, test } from "bun:test"
import type { InboxActivityItem, InboxThread, InboxThreadState } from "../../shared/inbox/types"
import { groupByDay, hasActiveFilter, oldestTimestamp, olderPageCursors, visibleRecords } from "./inboxFilter"

function thread(id: string, state: InboxThreadState, lastMessageAt: number, overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id,
    sourceKind: "webhook",
    sourceId: "h1",
    sourceName: "CI",
    threadKey: id,
    sender: "ada",
    messages: [],
    state,
    unread: false,
    lastMessageAt,
    replyCount: 0,
    ...overrides,
  }
}

function item(id: string, ts: number, overrides: Partial<InboxActivityItem> = {}): InboxActivityItem {
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
    ...overrides,
  }
}

function ids(records: ReturnType<typeof visibleRecords>): string[] {
  return records.map((record) => record.id)
}

describe("visibleRecords", () => {
  test("the inbox tab holds live threads and attention items, unread first then newest", () => {
    const threads = [
      thread("old-unread", "needs_you", 100, { unread: true }),
      thread("new-read", "fyi", 300),
      thread("replied", "replied", 400),
      thread("archived", "archived", 500),
    ]
    const items = [item("quiet", 600), item("alarm", 200, { attention: true })]
    expect(ids(visibleRecords("inbox", threads, items, {}))).toEqual(["old-unread", "new-read", "alarm"])
  })

  test("the activity tab holds every record newest first", () => {
    const threads = [thread("a", "archived", 500), thread("b", "needs_you", 100)]
    const items = [item("c", 300)]
    expect(ids(visibleRecords("activity", threads, items, {}))).toEqual(["a", "c", "b"])
  })

  test("source kind and attention filters narrow both threads and items", () => {
    const threads = [thread("w", "needs_you", 100), thread("m", "fyi", 200, { sourceKind: "mcp" })]
    const items = [item("i", 300, { attention: true, source: { kind: "webhook", hookId: "h", hookName: "CI" } })]
    expect(ids(visibleRecords("activity", threads, items, { sourceKind: "mcp" }))).toEqual(["m"])
    expect(ids(visibleRecords("activity", threads, items, { attentionOnly: true }))).toEqual(["i", "w"])
  })

  test("a project filter matches items only because threads carry no project", () => {
    const threads = [thread("t", "new", 100)]
    const items = [item("a", 200, { projectId: "p1" }), item("b", 300, { projectId: "p2" })]
    expect(ids(visibleRecords("activity", threads, items, { projectId: "p1" }))).toEqual(["a"])
  })
})

describe("hasActiveFilter", () => {
  test("is false for an empty filter and true once any field is set", () => {
    expect(hasActiveFilter({})).toBe(false)
    expect(hasActiveFilter({ attentionOnly: false })).toBe(false)
    expect(hasActiveFilter({ chatId: "c" })).toBe(true)
  })
})

describe("groupByDay", () => {
  const now = new Date(2026, 9, 20, 15, 0).getTime()

  test("names today and yesterday and starts a new group per local day", () => {
    const records = visibleRecords("activity", [], [
      item("a", new Date(2026, 9, 20, 9, 0).getTime()),
      item("b", new Date(2026, 9, 20, 1, 0).getTime()),
      item("c", new Date(2026, 9, 19, 23, 0).getTime()),
      item("d", new Date(2026, 9, 10, 12, 0).getTime()),
    ], {})
    const groups = groupByDay(records, now)
    expect(groups.map((group) => group.label).slice(0, 2)).toEqual(["Today", "Yesterday"])
    expect(groups.map((group) => group.records.map((record) => record.id))).toEqual([["a", "b"], ["c"], ["d"]])
  })
})

describe("oldestTimestamp", () => {
  test("is null when nothing is loaded", () => {
    expect(oldestTimestamp([])).toBeNull()
    expect(oldestTimestamp(visibleRecords("activity", [thread("a", "fyi", 50)], [item("b", 20)], {}))).toBe(20)
  })
})

describe("olderPageCursors", () => {
  test("pages each kind from its own oldest record so a busy kind never hides the older rows of a quiet one", () => {
    const threads = [thread("a", "fyi", 100), thread("b", "fyi", 400)]
    const items = [item("c", 900), item("d", 700)]
    expect(olderPageCursors(threads, items, {})).toEqual({ threadBefore: 100, itemBefore: 700 })
  })

  test("starts from the top when nothing of a kind matches the filter", () => {
    const cursors = olderPageCursors([thread("a", "fyi", 100)], [item("c", 900)], { chatId: "none" })
    expect(cursors).toEqual({ threadBefore: Number.MAX_SAFE_INTEGER, itemBefore: Number.MAX_SAFE_INTEGER })
  })
})
