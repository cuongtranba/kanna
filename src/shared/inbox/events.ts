import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "../json"
import type { BusSource } from "../service-bus/envelope"
import {
  isInboxVerdict,
  type InboundMessage,
  type InboxActivityItem,
  type InboxReport,
  type InboxSourceKind,
  type InboxThread,
} from "./types"

export type InboxThreadHeader = Pick<InboxThread, "id" | "sourceKind" | "sourceId" | "sourceName" | "threadKey" | "sender">

interface InboxEventBase {
  v: 1
  ts: number
}

export type InboxEvent =
  | (InboxEventBase & { kind: "inbox_activity_added"; item: InboxActivityItem })
  | (InboxEventBase & { kind: "inbox_thread_message_added"; thread: InboxThreadHeader; message: InboundMessage })
  | (InboxEventBase & { kind: "inbox_thread_chat_bound"; threadId: string; chatId: string })
  | (InboxEventBase & { kind: "inbox_thread_reported"; threadId: string; report: InboxReport })
  | (InboxEventBase & { kind: "inbox_thread_pending"; threadId: string; scheduleId: string })
  | (InboxEventBase & { kind: "inbox_thread_read"; ids: string[] })
  | (InboxEventBase & { kind: "inbox_all_read"; beforeTs: number })
  | (InboxEventBase & { kind: "inbox_thread_replied"; threadId: string; chatId: string; scheduleId: string })
  | (InboxEventBase & { kind: "inbox_thread_archived"; threadId: string })

export type InboxEventKind = InboxEvent["kind"]

function str(object: JsonObject, key: string): string | null {
  const value = object[key]
  return typeof value === "string" ? value : null
}

function num(object: JsonObject, key: string): number | null {
  const value = object[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function optionalStr(object: JsonObject, key: string): string | undefined {
  const value = object[key]
  return typeof value === "string" ? value : undefined
}

function parseSource(value: JsonValue | undefined): BusSource | null {
  if (value === undefined || !isJsonObject(value)) return null
  const kind = str(value, "kind")
  if (kind === "store") {
    const log = str(value, "log")
    return log === null ? null : { kind, log }
  }
  if (kind === "transcript") {
    const chatId = str(value, "chatId")
    return chatId === null ? null : { kind, chatId }
  }
  if (kind === "webhook") {
    const hookId = str(value, "hookId")
    const hookName = str(value, "hookName")
    return hookId === null || hookName === null ? null : { kind, hookId, hookName }
  }
  if (kind === "mcp") {
    const sourceId = str(value, "sourceId")
    const sourceName = str(value, "sourceName")
    const serverId = str(value, "serverId")
    const serverName = str(value, "serverName")
    if (sourceId === null || sourceName === null || serverId === null || serverName === null) return null
    return { kind, sourceId, sourceName, serverId, serverName }
  }
  return kind === "inbox" ? { kind } : null
}

function parseItem(value: JsonValue | undefined): InboxActivityItem | null {
  if (value === undefined || !isJsonObject(value)) return null
  const id = str(value, "id")
  const ts = num(value, "ts")
  const subject = str(value, "subject")
  const source = parseSource(value.source)
  const title = str(value, "title")
  const preview = str(value, "preview")
  const payload = value.payload
  if (id === null || ts === null || subject === null || source === null || title === null || preview === null) return null
  if (payload === undefined || typeof value.attention !== "boolean" || typeof value.unread !== "boolean") return null
  const chatId = optionalStr(value, "chatId")
  const projectId = optionalStr(value, "projectId")
  return {
    id,
    ts,
    subject,
    source,
    title,
    preview,
    payload,
    attention: value.attention,
    unread: value.unread,
    ...(chatId === undefined ? {} : { chatId }),
    ...(projectId === undefined ? {} : { projectId }),
  }
}

function parseMessage(value: JsonValue | undefined): InboundMessage | null {
  if (value === undefined || !isJsonObject(value)) return null
  const id = str(value, "id")
  const deliveryId = str(value, "deliveryId")
  const ts = num(value, "ts")
  const preview = str(value, "preview")
  const payload = value.payload
  if (id === null || deliveryId === null || ts === null || preview === null || payload === undefined) return null
  return { id, deliveryId, ts, payload, preview }
}

function parseReport(value: JsonValue | undefined): InboxReport | null {
  if (value === undefined || !isJsonObject(value)) return null
  const verdict = str(value, "verdict")
  const summary = str(value, "summary")
  const at = num(value, "at")
  const chatId = str(value, "chatId")
  if (verdict === null || !isInboxVerdict(verdict) || summary === null || at === null || chatId === null) return null
  const draftReply = optionalStr(value, "draftReply")
  return { verdict, summary, at, chatId, ...(draftReply === undefined ? {} : { draftReply }) }
}

function isSourceKind(value: string): value is InboxSourceKind {
  return value === "webhook" || value === "mcp"
}

function parseHeader(value: JsonValue | undefined): InboxThreadHeader | null {
  if (value === undefined || !isJsonObject(value)) return null
  const id = str(value, "id")
  const sourceKind = str(value, "sourceKind")
  const sourceId = str(value, "sourceId")
  const sourceName = str(value, "sourceName")
  const threadKey = str(value, "threadKey")
  const sender = str(value, "sender")
  if (id === null || sourceKind === null || !isSourceKind(sourceKind)) return null
  if (sourceId === null || sourceName === null || threadKey === null || sender === null) return null
  return { id, sourceKind, sourceId, sourceName, threadKey, sender }
}

function parseStringArray(value: JsonValue | undefined): string[] | null {
  if (value === undefined || !isJsonArray(value)) return null
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") return null
    out.push(entry)
  }
  return out
}

export function parseInboxEvent(value: JsonValue): InboxEvent | null {
  if (!isJsonObject(value) || value.v !== 1) return null
  const ts = num(value, "ts")
  const kind = str(value, "kind")
  if (ts === null || kind === null) return null
  switch (kind) {
    case "inbox_activity_added": {
      const item = parseItem(value.item)
      return item === null ? null : { v: 1, ts, kind, item }
    }
    case "inbox_thread_message_added": {
      const thread = parseHeader(value.thread)
      const message = parseMessage(value.message)
      return thread === null || message === null ? null : { v: 1, ts, kind, thread, message }
    }
    case "inbox_thread_chat_bound": {
      const threadId = str(value, "threadId")
      const chatId = str(value, "chatId")
      return threadId === null || chatId === null ? null : { v: 1, ts, kind, threadId, chatId }
    }
    case "inbox_thread_reported": {
      const threadId = str(value, "threadId")
      const report = parseReport(value.report)
      return threadId === null || report === null ? null : { v: 1, ts, kind, threadId, report }
    }
    case "inbox_thread_pending": {
      const threadId = str(value, "threadId")
      const scheduleId = str(value, "scheduleId")
      return threadId === null || scheduleId === null ? null : { v: 1, ts, kind, threadId, scheduleId }
    }
    case "inbox_thread_read": {
      const ids = parseStringArray(value.ids)
      return ids === null ? null : { v: 1, ts, kind, ids }
    }
    case "inbox_all_read": {
      const beforeTs = num(value, "beforeTs")
      return beforeTs === null ? null : { v: 1, ts, kind, beforeTs }
    }
    case "inbox_thread_replied": {
      const threadId = str(value, "threadId")
      const chatId = str(value, "chatId")
      const scheduleId = str(value, "scheduleId")
      return threadId === null || chatId === null || scheduleId === null ? null : { v: 1, ts, kind, threadId, chatId, scheduleId }
    }
    case "inbox_thread_archived": {
      const threadId = str(value, "threadId")
      return threadId === null ? null : { v: 1, ts, kind, threadId }
    }
    default:
      return null
  }
}
