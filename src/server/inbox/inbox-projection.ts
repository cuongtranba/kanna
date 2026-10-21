import type { InboxEvent } from "../../shared/inbox/events"
import { isAttention, isToolRequestPutFor, settledToolRequestId } from "../../shared/inbox/policy"
import {
  INBOX_MAX_ITEMS,
  INBOX_THREAD_MAX_MESSAGES,
  INBOX_UNREAD_KEEP_MS,
  type InboxActivityItem,
  type InboxThread,
} from "../../shared/inbox/types"

export interface InboxState {
  threads: Map<string, InboxThread>
  items: InboxActivityItem[]
  pendingSince: Map<string, number>
}

export function createInboxState(): InboxState {
  return { threads: new Map(), items: [], pendingSince: new Map() }
}

export function threadLookupKey(sourceKind: string, sourceId: string, threadKey: string): string {
  return `${sourceKind}\u0000${sourceId}\u0000${threadKey}`
}

export function findThreadByKey(state: InboxState, sourceKind: string, sourceId: string, threadKey: string): InboxThread | null {
  const key = threadLookupKey(sourceKind, sourceId, threadKey)
  for (const thread of state.threads.values()) {
    if (threadLookupKey(thread.sourceKind, thread.sourceId, thread.threadKey) === key) return thread
  }
  return null
}

function clearPending(state: InboxState, thread: InboxThread): void {
  delete thread.pendingScheduleId
  state.pendingSince.delete(thread.id)
}

function addActivityItem(state: InboxState, incoming: InboxActivityItem): void {
  if (state.items.some((item) => item.id === incoming.id)) return
  const attention = incoming.attention && isAttention(incoming)
  state.items.push({ ...incoming, attention, unread: incoming.unread && attention })
  const settledId = settledToolRequestId(incoming)
  if (settledId === null) return
  for (const item of state.items) {
    if (isToolRequestPutFor(item, settledId)) {
      item.attention = false
      item.unread = false
    }
  }
}

export function applyInboxEvent(state: InboxState, event: InboxEvent): void {
  switch (event.kind) {
    case "inbox_activity_added": {
      addActivityItem(state, event.item)
      return
    }
    case "inbox_thread_message_added": {
      const existing = state.threads.get(event.thread.id)
      const thread: InboxThread = existing ?? {
        ...event.thread,
        messages: [],
        state: "new",
        unread: true,
        lastMessageAt: event.message.ts,
        replyCount: 0,
      }
      if (thread.messages.some((message) => message.id === event.message.id)) return
      thread.messages.push(event.message)
      if (thread.messages.length > INBOX_THREAD_MAX_MESSAGES) {
        thread.messages.splice(0, thread.messages.length - INBOX_THREAD_MAX_MESSAGES)
      }
      thread.state = "new"
      thread.unread = true
      thread.lastMessageAt = event.message.ts
      delete thread.report
      clearPending(state, thread)
      state.threads.set(thread.id, thread)
      return
    }
    case "inbox_thread_chat_bound": {
      const thread = state.threads.get(event.threadId)
      if (thread) thread.chatId = event.chatId
      return
    }
    case "inbox_thread_reported": {
      const thread = state.threads.get(event.threadId)
      if (!thread) return
      thread.report = event.report
      thread.state = event.report.verdict
      thread.unread = event.report.verdict === "needs_you"
      clearPending(state, thread)
      return
    }
    case "inbox_thread_pending": {
      const thread = state.threads.get(event.threadId)
      if (!thread) return
      thread.pendingScheduleId = event.scheduleId
      state.pendingSince.set(thread.id, event.ts)
      return
    }
    case "inbox_thread_read": {
      for (const id of event.ids) {
        const thread = state.threads.get(id)
        if (thread) thread.unread = false
      }
      for (const item of state.items) {
        if (event.ids.includes(item.id)) item.unread = false
      }
      return
    }
    case "inbox_all_read": {
      for (const thread of state.threads.values()) {
        if (thread.lastMessageAt <= event.beforeTs) thread.unread = false
      }
      for (const item of state.items) {
        if (item.ts <= event.beforeTs) item.unread = false
      }
      return
    }
    case "inbox_thread_replied": {
      const thread = state.threads.get(event.threadId)
      if (!thread) return
      thread.state = "replied"
      thread.unread = false
      thread.replyCount += 1
      thread.chatId ??= event.chatId
      clearPending(state, thread)
      return
    }
    case "inbox_thread_archived": {
      const thread = state.threads.get(event.threadId)
      if (!thread) return
      thread.state = "archived"
      thread.unread = false
      clearPending(state, thread)
    }
  }
}

function isProtected(thread: InboxThread, now: number): boolean {
  return thread.unread && now - thread.lastMessageAt < INBOX_UNREAD_KEEP_MS
}

export function liveRecordCount(state: InboxState): number {
  return state.threads.size + state.items.length
}

export function trimInboxState(state: InboxState, now: number): Set<string> {
  const dropped = new Set<string>()
  while (liveRecordCount(state) > INBOX_MAX_ITEMS) {
    const oldestItem = state.items[0]
    let oldestThread: InboxThread | null = null
    for (const thread of state.threads.values()) {
      if (isProtected(thread, now)) continue
      if (oldestThread === null || thread.lastMessageAt < oldestThread.lastMessageAt) oldestThread = thread
    }
    const dropItem = oldestItem !== undefined && (oldestThread === null || oldestItem.ts <= oldestThread.lastMessageAt)
    if (dropItem) {
      state.items.shift()
      dropped.add(oldestItem.id)
    } else if (oldestThread !== null) {
      state.threads.delete(oldestThread.id)
      state.pendingSince.delete(oldestThread.id)
      dropped.add(oldestThread.id)
    } else {
      break
    }
  }
  return dropped
}

function eventTargets(event: InboxEvent): string[] {
  switch (event.kind) {
    case "inbox_activity_added":
      return [event.item.id]
    case "inbox_thread_message_added":
      return [event.thread.id]
    case "inbox_thread_chat_bound":
    case "inbox_thread_reported":
    case "inbox_thread_pending":
    case "inbox_thread_replied":
    case "inbox_thread_archived":
      return [event.threadId]
    case "inbox_thread_read":
      return event.ids
    case "inbox_all_read":
      return []
  }
}

export function compactInboxEvents(events: readonly InboxEvent[], dropped: ReadonlySet<string>): InboxEvent[] {
  let lastAllRead = -1
  events.forEach((event, index) => {
    if (event.kind === "inbox_all_read") lastAllRead = index
  })
  const kept: InboxEvent[] = []
  events.forEach((event, index) => {
    if (event.kind === "inbox_all_read") {
      if (index === lastAllRead) kept.push(event)
      return
    }
    if (event.kind === "inbox_thread_read") {
      const ids = event.ids.filter((id) => !dropped.has(id))
      if (ids.length > 0) kept.push({ ...event, ids })
      return
    }
    if (eventTargets(event).some((id) => dropped.has(id))) return
    kept.push(event)
  })
  return kept
}
