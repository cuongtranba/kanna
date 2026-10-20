import { toError } from "../../shared/errors"
import type { InboxEvent } from "../../shared/inbox/events"
import { describeEnvelope, previewOfPayload } from "../../shared/inbox/describe"
import { isAttention } from "../../shared/inbox/policy"
import {
  INBOX_DRAFT_MAX_CHARS,
  INBOX_SUMMARY_MAX_CHARS,
  type InboundMessage,
  type InboxActivityItem,
  type InboxFilter,
  type InboxReport,
  type InboxSnapshot,
  type InboxSourceKind,
  type InboxThread,
  type InboxVerdict,
} from "../../shared/inbox/types"
import { log } from "../../shared/log"
import { busSubject, type BusEnvelope } from "../../shared/service-bus/envelope"
import type { ServiceBus } from "../service-bus/service-bus"
import {
  applyInboxEvent,
  compactInboxEvents,
  createInboxState,
  findThreadByKey,
  liveRecordCount,
  trimInboxState,
  type InboxState,
} from "./inbox-projection"

export interface InboxLogPort {
  append(event: InboxEvent): Promise<void>
  readAll(): Promise<InboxEvent[]>
  rewrite(events: readonly InboxEvent[]): Promise<void>
}

export interface InboundIngestMeta {
  threadKey: string
  sender: string
  sourceName: string
  deliveryId: string
}

export type InboxReportResult = { ok: true } | { ok: false; error: string }

export interface InboxPage {
  threads: InboxThread[]
  items: InboxActivityItem[]
}

const DEFAULT_SNAPSHOT_LIMIT = 200
const INBOX_SUBJECT_PREFIX = "kanna.inbox."
const TURN_END_SUBJECTS: readonly string[] = ["kanna.turn.finished", "kanna.turn.failed"]

function cloneThread(thread: InboxThread): InboxThread {
  return { ...thread, messages: [...thread.messages] }
}

function sourceOf(envelope: BusEnvelope): { kind: InboxSourceKind; id: string } | null {
  if (envelope.source.kind === "webhook") return { kind: "webhook", id: envelope.source.hookId }
  if (envelope.source.kind === "mcp") return { kind: "mcp", id: envelope.source.sourceId }
  return null
}

function threadMatches(thread: InboxThread, filter: InboxFilter): boolean {
  if (filter.sourceKind !== undefined && thread.sourceKind !== filter.sourceKind) return false
  if (filter.projectId !== undefined) return false
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

export class InboxRegistry {
  private state: InboxState = createInboxState()
  private writeChain: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<() => void>()
  private readonly needsYouListeners = new Set<(thread: InboxThread) => void>()
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly logPort: InboxLogPort,
    private readonly bus: Pick<ServiceBus, "subscribe" | "publish">,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<void> {
    const events = await this.logPort.readAll()
    this.state = createInboxState()
    for (const event of events) applyInboxEvent(this.state, event)
    const dropped = trimInboxState(this.state, this.now())
    if (events.length > 2 * liveRecordCount(this.state)) {
      await this.logPort.rewrite(compactInboxEvents(events, dropped))
    }
    this.unsubscribe?.()
    this.unsubscribe = this.bus.subscribe("kanna.>", (envelope) => this.onEnvelope(envelope))
  }

  async flush(): Promise<void> {
    await this.writeChain
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  onNeedsYou(listener: (thread: InboxThread) => void): () => void {
    this.needsYouListeners.add(listener)
    return () => {
      this.needsYouListeners.delete(listener)
    }
  }

  getThread(id: string): InboxThread | null {
    const thread = this.state.threads.get(id)
    return thread ? cloneThread(thread) : null
  }

  unreadCount(): number {
    let count = 0
    for (const thread of this.state.threads.values()) if (thread.unread) count += 1
    for (const item of this.state.items) if (item.unread && item.attention) count += 1
    return count
  }

  snapshot(limit: number = DEFAULT_SNAPSHOT_LIMIT): InboxSnapshot {
    const threads = [...this.state.threads.values()]
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .slice(0, limit)
      .map(cloneThread)
    const items = [...this.state.items].sort((a, b) => b.ts - a.ts).slice(0, limit)
    return { threads, items, unreadCount: this.unreadCount(), total: liveRecordCount(this.state) }
  }

  page(beforeTs: number, limit: number, filter: InboxFilter = {}): InboxPage {
    const threads = [...this.state.threads.values()]
      .filter((thread) => thread.lastMessageAt < beforeTs && threadMatches(thread, filter))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .slice(0, limit)
      .map(cloneThread)
    const items = this.state.items
      .filter((item) => item.ts < beforeTs && itemMatches(item, filter))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit)
    return { threads, items }
  }

  async ingestInbound(envelope: BusEnvelope, meta: InboundIngestMeta): Promise<InboxThread> {
    const source = sourceOf(envelope)
    if (source === null) throw new Error("Not an inbound source envelope")
    const existing = findThreadByKey(this.state, source.kind, source.id, meta.threadKey)
    if (existing?.messages.some((message) => message.deliveryId === meta.deliveryId)) return cloneThread(existing)
    const message: InboundMessage = {
      id: envelope.id,
      deliveryId: meta.deliveryId,
      ts: envelope.ts,
      payload: envelope.payload,
      preview: previewOfPayload(envelope.payload),
    }
    const thread = existing ?? null
    this.record({
      v: 1,
      ts: this.now(),
      kind: "inbox_thread_message_added",
      thread: {
        id: thread?.id ?? crypto.randomUUID(),
        sourceKind: source.kind,
        sourceId: source.id,
        sourceName: meta.sourceName,
        threadKey: meta.threadKey,
        sender: meta.sender,
      },
      message,
    })
    await this.flush()
    const stored = findThreadByKey(this.state, source.kind, source.id, meta.threadKey)
    if (stored === null) throw new Error("Inbox thread was not stored")
    return cloneThread(stored)
  }

  async bindChat(threadId: string, chatId: string): Promise<void> {
    if (!this.state.threads.has(threadId)) return
    this.record({ v: 1, ts: this.now(), kind: "inbox_thread_chat_bound", threadId, chatId })
    await this.flush()
  }

  async markPending(threadId: string, scheduleId: string): Promise<void> {
    if (!this.state.threads.has(threadId)) return
    this.record({ v: 1, ts: this.now(), kind: "inbox_thread_pending", threadId, scheduleId })
    await this.flush()
  }

  async report(
    threadId: string,
    chatId: string,
    verdict: InboxVerdict,
    summary: string,
    draftReply?: string,
  ): Promise<InboxReportResult> {
    const thread = this.state.threads.get(threadId)
    if (!thread) return { ok: false, error: `Unknown inbox thread ${threadId}` }
    if (thread.state === "archived") return { ok: false, error: "This thread is archived" }
    if (thread.chatId === undefined || thread.chatId !== chatId) {
      return { ok: false, error: "This chat is not the handler of that thread" }
    }
    const draft = draftReply?.trim()
    const report: InboxReport = {
      verdict,
      summary: summary.trim().slice(0, INBOX_SUMMARY_MAX_CHARS),
      at: this.now(),
      chatId,
      ...(draft ? { draftReply: draft.slice(0, INBOX_DRAFT_MAX_CHARS) } : {}),
    }
    await this.applyReport(threadId, report)
    return { ok: true }
  }

  async escalate(threadId: string, chatId: string): Promise<void> {
    const thread = this.state.threads.get(threadId)
    if (!thread || thread.state === "archived") return
    await this.applyReport(threadId, { verdict: "needs_you", summary: "", at: this.now(), chatId })
  }

  async markRead(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    this.record({ v: 1, ts: this.now(), kind: "inbox_thread_read", ids: [...ids] })
    this.publishInbox("read", { ids: [...ids] })
    await this.flush()
  }

  async markAllRead(beforeTs: number = this.now()): Promise<void> {
    this.record({ v: 1, ts: this.now(), kind: "inbox_all_read", beforeTs })
    this.publishInbox("read", { beforeTs })
    await this.flush()
  }

  async markReplied(threadId: string, chatId: string, scheduleId: string): Promise<void> {
    if (!this.state.threads.has(threadId)) return
    this.record({ v: 1, ts: this.now(), kind: "inbox_thread_replied", threadId, chatId, scheduleId })
    this.publishInbox("replied", { threadId, chatId, scheduleId })
    await this.flush()
  }

  async archive(threadId: string): Promise<void> {
    if (!this.state.threads.has(threadId)) return
    this.record({ v: 1, ts: this.now(), kind: "inbox_thread_archived", threadId })
    this.publishInbox("archived", { threadId })
    await this.flush()
  }

  private async applyReport(threadId: string, report: InboxReport): Promise<void> {
    const wasNeedsYou = this.state.threads.get(threadId)?.state === "needs_you"
    this.record({ v: 1, ts: this.now(), kind: "inbox_thread_reported", threadId, report })
    this.publishInbox("reported", { threadId, verdict: report.verdict, chatId: report.chatId })
    await this.flush()
    const thread = this.state.threads.get(threadId)
    if (thread && report.verdict === "needs_you" && !wasNeedsYou) this.fireNeedsYou(cloneThread(thread))
  }

  private onEnvelope(envelope: BusEnvelope): void {
    if (envelope.direction !== "internal") return
    if (envelope.subject.startsWith(INBOX_SUBJECT_PREFIX)) return
    this.record({ v: 1, ts: this.now(), kind: "inbox_activity_added", item: this.itemOf(envelope) })
    if (TURN_END_SUBJECTS.includes(envelope.subject)) this.escalatePendingThreads(envelope)
  }

  private itemOf(envelope: BusEnvelope): InboxActivityItem {
    const attention = isAttention(envelope)
    const { title, preview } = describeEnvelope(envelope)
    return {
      id: envelope.id,
      ts: envelope.ts,
      subject: envelope.subject,
      source: envelope.source,
      title,
      preview,
      payload: envelope.payload,
      attention,
      unread: attention,
      ...(envelope.chatId === undefined ? {} : { chatId: envelope.chatId }),
      ...(envelope.projectId === undefined ? {} : { projectId: envelope.projectId }),
    }
  }

  private escalatePendingThreads(envelope: BusEnvelope): void {
    if (envelope.chatId === undefined) return
    for (const thread of this.state.threads.values()) {
      if (thread.pendingScheduleId === undefined || thread.chatId !== envelope.chatId) continue
      const since = this.state.pendingSince.get(thread.id) ?? 0
      if (envelope.ts < since) continue
      void this.escalate(thread.id, envelope.chatId)
    }
  }

  private record(event: InboxEvent): void {
    applyInboxEvent(this.state, event)
    trimInboxState(this.state, this.now())
    this.writeChain = this.writeChain
      .then(() => this.logPort.append(event))
      .catch((error) => {
        log.warn("[inbox] append failed:", toError(error))
      })
    this.notify()
  }

  private publishInbox(verb: string, payload: Record<string, string | number | string[]>): void {
    const ts = this.now()
    this.bus.publish({
      v: 1,
      id: crypto.randomUUID(),
      subject: busSubject("inbox", verb),
      ts,
      source: { kind: "inbox" },
      direction: "internal",
      idempotencyKey: `inbox:${verb}:${JSON.stringify(payload)}:${ts}`,
      payload,
    })
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private fireNeedsYou(thread: InboxThread): void {
    for (const listener of this.needsYouListeners) listener(thread)
  }
}
