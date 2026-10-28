import { inboxTab } from "../../shared/inbox/policy"
import type { InboxActivityItem, InboxFilter, InboxThread } from "../../shared/inbox/types"

export type InboxTabId = "inbox" | "activity"

export type InboxRecord =
  | { kind: "thread"; id: string; ts: number; unread: boolean; thread: InboxThread }
  | { kind: "item"; id: string; ts: number; unread: boolean; item: InboxActivityItem }

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

function threadsSurviveProjectFilter(filter: InboxFilter): boolean {
  return filter.projectId === undefined
}

function threadMatches(thread: InboxThread, filter: InboxFilter): boolean {
  if (!threadsSurviveProjectFilter(filter)) return false
  if (filter.sourceKind !== undefined && thread.sourceKind !== filter.sourceKind) return false
  if (filter.chatId !== undefined && thread.chatId !== filter.chatId) return false
  if (filter.attentionOnly === true && thread.state !== "needs_you" && thread.state !== "new") return false
  return true
}

function itemMatches(item: InboxActivityItem, filter: InboxFilter): boolean {
  if (filter.sourceKind !== undefined && item.source.kind !== filter.sourceKind) return false
  if (filter.projectId !== undefined && item.projectId !== filter.projectId) return false
  if (filter.chatId !== undefined && item.chatId !== filter.chatId) return false
  if (filter.attentionOnly === true && !item.attention) return false
  return true
}

function byInboxOrder(a: InboxRecord, b: InboxRecord): number {
  if (a.unread !== b.unread) return a.unread ? -1 : 1
  return b.ts - a.ts
}

function byNewest(a: InboxRecord, b: InboxRecord): number {
  return b.ts - a.ts
}

export function visibleRecords(
  tab: InboxTabId,
  threads: readonly InboxThread[],
  items: readonly InboxActivityItem[],
  filter: InboxFilter,
): InboxRecord[] {
  const inInbox = tab === "inbox"
  const records = [
    ...threads
      .filter((thread) => (!inInbox || inboxTab(thread)) && threadMatches(thread, filter))
      .map(threadRecord),
    ...items
      .filter((item) => (!inInbox || inboxTab(item)) && itemMatches(item, filter))
      .map(itemRecord),
  ]
  return records.sort(inInbox ? byInboxOrder : byNewest)
}

export function hasActiveFilter(filter: InboxFilter): boolean {
  return (
    filter.sourceKind !== undefined
    || filter.projectId !== undefined
    || filter.chatId !== undefined
    || filter.attentionOnly === true
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

export function groupByDay(records: readonly InboxRecord[], now: number): InboxDayGroup[] {
  const today = startOfDay(now)
  const groups: { dayStart: number; records: InboxRecord[] }[] = []
  for (const record of records) {
    const dayStart = startOfDay(record.ts)
    const last = groups[groups.length - 1]
    if (last !== undefined && last.dayStart === dayStart) last.records.push(record)
    else groups.push({ dayStart, records: [record] })
  }
  return groups.map((group) => ({
    key: String(group.dayStart),
    label: dayLabel(group.dayStart, today),
    records: group.records,
  }))
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
  const threadBefore = oldestTimestamp(threads.filter((thread) => threadMatches(thread, filter)).map(threadRecord))
  const itemBefore = oldestTimestamp(items.filter((item) => itemMatches(item, filter)).map(itemRecord))
  return {
    threadBefore: threadBefore ?? Number.MAX_SAFE_INTEGER,
    itemBefore: itemBefore ?? Number.MAX_SAFE_INTEGER,
  }
}
