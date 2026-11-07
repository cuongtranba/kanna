import type { InboxEvent } from "../../shared/inbox/events"
import { isAttention, isSnoozable, isSnoozed, isToolRequestPutFor, settledToolRequestId } from "../../shared/inbox/policy"
import {
  INBOX_MAX_ITEMS,
  INBOX_THREAD_MAX_DRAFTS,
  INBOX_THREAD_MAX_MESSAGES,
  INBOX_UNREAD_KEEP_MS,
  type InboxActivityItem,
  type InboxThread,
  type InboxThreadState,
} from "../../shared/inbox/types"

export interface InboxState {
  threads: Map<string, InboxThread>
  items: InboxActivityItem[]
  pendingSince: Map<string, number>
  pendingInstruction: Map<string, string>
  mutedSenders: Set<string>
  archivedFrom: Map<string, ArchivedFrom>
}

interface ArchivedFrom {
  state: Exclude<InboxThreadState, "archived">
  unread: boolean
}

export function createInboxState(): InboxState {
  return { threads: new Map(), items: [], pendingSince: new Map(), pendingInstruction: new Map(), mutedSenders: new Set(), archivedFrom: new Map() }
}

export function threadLookupKey(sourceKind: string, sourceId: string, threadKey: string): string {
  return `${sourceKind}\u0000${sourceId}\u0000${threadKey}`
}

export function senderMuteKey(sourceKind: string, sourceId: string, sender: string): string {
  return `${sourceKind}\u0000${sourceId}\u0000${sender}`
}

function isSenderMuted(state: InboxState, thread: Pick<InboxThread, "sourceKind" | "sourceId" | "sender">): boolean {
  return state.mutedSenders.has(senderMuteKey(thread.sourceKind, thread.sourceId, thread.sender))
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
  state.pendingInstruction.delete(thread.id)
}

function endSnoozeUnlessSnoozable(thread: InboxThread): void {
  if (!isSnoozable(thread)) delete thread.snoozedUntil
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
        outbound: [],
        drafts: [],
        state: "new",
        unread: true,
        lastMessageAt: event.message.ts,
        replyCount: 0,
        muted: isSenderMuted(state, event.thread),
      }
      if (thread.messages.some((message) => message.id === event.message.id)) return
      thread.messages.push(event.message)
      if (thread.messages.length > INBOX_THREAD_MAX_MESSAGES) {
        thread.messages.splice(0, thread.messages.length - INBOX_THREAD_MAX_MESSAGES)
      }
      state.archivedFrom.delete(thread.id)
      delete thread.snoozedUntil
      thread.state = "new"
      thread.unread = !thread.muted
      thread.lastMessageAt = event.message.ts
      delete thread.report
      delete thread.proposal
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
      thread.unread = event.report.verdict === "needs_you" && !thread.muted
      endSnoozeUnlessSnoozable(thread)
      clearPending(state, thread)
      return
    }
    case "inbox_thread_pending": {
      const thread = state.threads.get(event.threadId)
      if (!thread) return
      thread.pendingScheduleId = event.scheduleId
      state.pendingSince.set(thread.id, event.ts)
      if (event.instruction === undefined) state.pendingInstruction.delete(thread.id)
      else state.pendingInstruction.set(thread.id, event.instruction)
      return
    }
    case "inbox_thread_draft_added": {
      const thread = state.threads.get(event.threadId)
      if (!thread || thread.drafts.some((draft) => draft.id === event.draft.id)) return
      thread.drafts.push(event.draft)
      if (thread.drafts.length > INBOX_THREAD_MAX_DRAFTS) {
        thread.drafts.splice(0, thread.drafts.length - INBOX_THREAD_MAX_DRAFTS)
      }
      return
    }
    case "inbox_thread_read": {
      const read = event.read ?? true
      for (const id of event.ids) {
        const thread = state.threads.get(id)
        if (thread) thread.unread = !read && thread.state !== "archived" && !thread.muted
      }
      for (const item of state.items) {
        if (event.ids.includes(item.id)) item.unread = !read && item.attention
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
      endSnoozeUnlessSnoozable(thread)
      clearPending(state, thread)
      return
    }
    case "inbox_thread_archived": {
      const thread = state.threads.get(event.threadId)
      if (!thread || thread.state === "archived") return
      state.archivedFrom.set(thread.id, { state: thread.state, unread: thread.unread })
      thread.state = "archived"
      thread.unread = false
      endSnoozeUnlessSnoozable(thread)
      clearPending(state, thread)
      return
    }
    case "inbox_thread_snoozed": {
      const thread = state.threads.get(event.threadId)
      if (thread && isSnoozable(thread)) thread.snoozedUntil = event.until
      return
    }
    case "inbox_thread_unsnoozed": {
      const thread = state.threads.get(event.threadId)
      if (!thread || !isSnoozed(thread)) return
      delete thread.snoozedUntil
      if (event.reason === "time") thread.unread = !thread.muted
      return
    }
    case "inbox_thread_unarchived": {
      const thread = state.threads.get(event.threadId)
      const restored = state.archivedFrom.get(event.threadId)
      if (!thread || thread.state !== "archived" || restored === undefined) return
      state.archivedFrom.delete(thread.id)
      thread.state = restored.state
      thread.unread = restored.unread && !thread.muted
      return
    }
    case "inbox_thread_outbound_queued": {
      const thread = state.threads.get(event.threadId)
      if (!thread || thread.outbound.some((outbound) => outbound.id === event.outbound.id)) return
      thread.outbound.push({ ...event.outbound, status: "pending" })
      if (thread.outbound.length > INBOX_THREAD_MAX_MESSAGES) {
        thread.outbound.splice(0, thread.outbound.length - INBOX_THREAD_MAX_MESSAGES)
      }
      return
    }
    case "inbox_thread_outbound_settled": {
      const thread = state.threads.get(event.threadId)
      const outbound = thread?.outbound.find((candidate) => candidate.id === event.outboundId)
      if (!thread || !outbound || outbound.status !== "pending") return
      outbound.status = event.status
      outbound.settledAt = event.at
      if (event.error !== undefined) outbound.error = event.error
      if (event.resultId !== undefined) outbound.resultId = event.resultId
      if (event.status !== "sent") return
      thread.state = "replied"
      thread.unread = false
      thread.replyCount += 1
      endSnoozeUnlessSnoozable(thread)
      clearPending(state, thread)
      return
    }
    case "inbox_thread_autonomy_set": {
      const thread = state.threads.get(event.threadId)
      if (!thread) return
      if (event.level === null) delete thread.autonomy
      else thread.autonomy = event.level
      return
    }
    case "inbox_thread_agent_paused": {
      const thread = state.threads.get(event.threadId)
      if (!thread) return
      if (event.until === null) delete thread.agentPausedUntil
      else thread.agentPausedUntil = event.until
      return
    }
    case "inbox_sender_muted": {
      const key = senderMuteKey(event.sourceKind, event.sourceId, event.sender)
      if (event.muted) state.mutedSenders.add(key)
      else state.mutedSenders.delete(key)
      for (const thread of state.threads.values()) {
        if (senderMuteKey(thread.sourceKind, thread.sourceId, thread.sender) !== key) continue
        thread.muted = event.muted
        if (!event.muted) continue
        thread.unread = false
        clearPending(state, thread)
      }
      return
    }
    case "inbox_thread_proposal_added": {
      const thread = state.threads.get(event.threadId)
      if (thread) thread.proposal = { ...event.proposal }
      return
    }
    case "inbox_thread_proposal_resolved": {
      const thread = state.threads.get(event.threadId)
      if (thread?.proposal?.id === event.proposalId) delete thread.proposal
      return
    }
    default: {
      const _never: never = event
      void _never
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
      state.pendingInstruction.delete(oldestThread.id)
      state.archivedFrom.delete(oldestThread.id)
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
    case "inbox_thread_draft_added":
    case "inbox_thread_replied":
    case "inbox_thread_archived":
    case "inbox_thread_unarchived":
    case "inbox_thread_snoozed":
    case "inbox_thread_unsnoozed":
    case "inbox_thread_outbound_queued":
    case "inbox_thread_outbound_settled":
    case "inbox_thread_autonomy_set":
    case "inbox_thread_agent_paused":
    case "inbox_thread_proposal_added":
    case "inbox_thread_proposal_resolved":
      return [event.threadId]
    case "inbox_thread_read":
      return event.ids
    case "inbox_all_read":
    case "inbox_sender_muted":
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
