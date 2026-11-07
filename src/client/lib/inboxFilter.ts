import { inboxItemMatchesFilter, inboxTab, inboxThreadMatchesFilter } from "../../shared/inbox/policy"
import type { InboxActivityItem, InboxFilter, InboxThread } from "../../shared/inbox/types"

export type InboxTabId = "inbox" | "activity"

export type InboxRecord =
  | { kind: "thread"; id: string; ts: number; unread: boolean; thread: InboxThread }
  | { kind: "item"; id: string; ts: number; unread: boolean; item: InboxActivityItem }

export type InboxQuickFilter = "all" | "needs_you" | "fyi" | "unread"

export const INBOX_QUICK_FILTERS: readonly { id: InboxQuickFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_you", label: "Needs you" },
  { id: "fyi", label: "FYI" },
  { id: "unread", label: "Unread" },
]

export type InboxQuickCounts = Readonly<Record<InboxQuickFilter, number>>

export const UNREAD_GROUP_KEY = "unread"

export interface InboxDayGroup {
  key: string
  label: string
  records: readonly InboxRecord[]
}

export const EMPTY_FILTER: InboxFilter = {}

export function threadRecord(thread: InboxThread): InboxRecord {
  return { kind: "thread", id: thread.id, ts: thread.lastMessageAt, unread: thread.unread, thread }
}

export function itemRecord(item: InboxActivityItem): InboxRecord {
  return { kind: "item", id: item.id, ts: item.ts, unread: item.unread, item }
}

function byInboxOrder(a: InboxRecord, b: InboxRecord): number {
  if (a.unread !== b.unread) return a.unread ? -1 : 1
  return b.ts - a.ts
}

function byNewest(a: InboxRecord, b: InboxRecord): number {
  return b.ts - a.ts
}

function matchesQuickFilter(record: InboxRecord, quick: InboxQuickFilter): boolean {
  switch (quick) {
    case "all": return true
    case "unread": return record.unread
    case "needs_you": return record.kind === "item" || record.thread.state === "needs_you"
    case "fyi": return record.kind === "thread" && record.thread.state === "fyi"
  }
}

function searchableFields(record: InboxRecord): string[] {
  if (record.kind === "item") return [record.item.title, record.item.preview]
  const { thread } = record
  return [thread.sender, thread.sourceName, thread.report?.summary ?? "", ...thread.messages.map((message) => message.preview)]
}

function matchesSearch(record: InboxRecord, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return searchableFields(record).some((field) => field.toLowerCase().includes(needle))
}

export function visibleRecords(
  tab: InboxTabId,
  threads: readonly InboxThread[],
  items: readonly InboxActivityItem[],
  filter: InboxFilter,
  quick: InboxQuickFilter = "all",
  query = "",
): InboxRecord[] {
  const inInbox = tab === "inbox"
  const records = [
    ...threads
      .filter((thread) => (!inInbox || inboxTab(thread)) && inboxThreadMatchesFilter(thread, filter))
      .map(threadRecord),
    ...items
      .filter((item) => (!inInbox || inboxTab(item)) && inboxItemMatchesFilter(item, filter))
      .map(itemRecord),
  ].filter((record) => matchesSearch(record, query) && (!inInbox || matchesQuickFilter(record, quick)))
  return records.sort(inInbox ? byInboxOrder : byNewest)
}

export function inboxQuickCounts(
  threads: readonly InboxThread[],
  items: readonly InboxActivityItem[],
  query: string,
): InboxQuickCounts {
  const records = visibleRecords("inbox", threads, items, EMPTY_FILTER, "all", query)
  const count = (quick: InboxQuickFilter) => records.filter((record) => matchesQuickFilter(record, quick)).length
  return { all: count("all"), needs_you: count("needs_you"), fyi: count("fyi"), unread: count("unread") }
}

export function hasActiveFilter(filter: InboxFilter): boolean {
  return (
    filter.sourceKind !== undefined
    || filter.projectId !== undefined
    || filter.chatId !== undefined
    || filter.attentionOnly === true
    || filter.sentByAgent === true
  )
}

function startOfDay(ts: number): number {
  const date = new Date(ts)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

function dayLabel(dayStart: number, today: number): string {
  const daysAgo = Math.round((today - dayStart) / DAY_MS)
  if (daysAgo <= 0) return "Today"
  if (daysAgo === 1) return "Yesterday"
  return new Date(dayStart).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

export function dayLabelFor(ts: number, now: number): string {
  return dayLabel(startOfDay(ts), startOfDay(now))
}

export function groupByDay(records: readonly InboxRecord[], now: number): InboxDayGroup[] {
  const today = startOfDay(now)
  const byDay = new Map<number, InboxRecord[]>()
  for (const record of records) {
    const dayStart = startOfDay(record.ts)
    const day = byDay.get(dayStart)
    if (day === undefined) byDay.set(dayStart, [record])
    else day.push(record)
  }
  return [...byDay].map(([dayStart, dayRecords]) => ({
    key: String(dayStart),
    label: dayLabel(dayStart, today),
    records: dayRecords,
  }))
}

export function groupRecords(tab: InboxTabId, records: readonly InboxRecord[], now: number): InboxDayGroup[] {
  if (tab === "activity") return groupByDay(records, now)
  const unread = records.filter((record) => record.unread)
  const read = records.filter((record) => !record.unread)
  const days = groupByDay(read, now)
  return unread.length === 0 ? days : [{ key: UNREAD_GROUP_KEY, label: "Unread", records: unread }, ...days]
}

export function oldestTimestamp(records: readonly InboxRecord[]): number | null {
  let oldest: number | null = null
  for (const record of records) if (oldest === null || record.ts < oldest) oldest = record.ts
  return oldest
}

export interface OlderCursors {
  threadBefore: number
  itemBefore: number
}

export function olderPageCursors(
  threads: readonly InboxThread[],
  items: readonly InboxActivityItem[],
  filter: InboxFilter,
): OlderCursors {
  const threadBefore = oldestTimestamp(threads.filter((thread) => inboxThreadMatchesFilter(thread, filter)).map(threadRecord))
  const itemBefore = oldestTimestamp(items.filter((item) => inboxItemMatchesFilter(item, filter)).map(itemRecord))
  return {
    threadBefore: threadBefore ?? Number.MAX_SAFE_INTEGER,
    itemBefore: itemBefore ?? Number.MAX_SAFE_INTEGER,
  }
}

export type InboxEmptyReason = "loading" | "search" | "quick" | "none"

export function inboxEmptyReason(input: {
  loaded: boolean
  tab: InboxTabId
  quick: InboxQuickFilter
  query: string
  inboxCount: number
}): InboxEmptyReason {
  if (!input.loaded) return "loading"
  if (input.query.trim().length > 0) return "search"
  if (input.tab === "inbox" && input.quick !== "all" && input.inboxCount > 0) return "quick"
  return "none"
}
