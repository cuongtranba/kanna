import type { ClientCommand } from "../../shared/protocol"
import type { ChatSnapshot } from "../../shared/types"
import {
  assistantTextAfter,
  clipText,
  flattenEntries,
  newestEntryTime,
  pendingToolRequests,
  readChat,
  runCommand,
  stringFieldOf,
  type CommandRunner,
  type EntryView,
  type PendingRequestView,
  type SnapshotReader,
} from "./remote-mcp-views"

const DEFAULT_POLL_INTERVAL_MS = 500
const STATUS_RECENT_LIMIT = 20
const FINAL_RECENT_LIMIT = 200
const IDLE_SETTLE_POLLS = 3
const HEARTBEAT_MS = 10_000
const ACTIVITY_LIMIT = 20
const ACTIVITY_TEXT_CHARS = 300
const BUSY_STATUSES: ReadonlySet<string> = new Set(["starting", "running"])
export const WAITING_FOR_USER = "waiting_for_user"

export type SendCommand = Extract<ClientCommand, { type: "chat.send" }>

export interface ChatFollowHost extends SnapshotReader {
  pollIntervalMs?: number
}

export interface SendHost extends CommandRunner, ChatFollowHost {}

export interface SentMessage {
  chatId: string
  queuedMessageId?: string
  baseline: number
}

export type SendOutcome = { ok: false; message: string } | { ok: true; sent: SentMessage }

export interface FollowRequest {
  chatId: string
  baseline: number
  queuedMessageId?: string
  queuedContent?: string
  timeoutMs: number
  signal?: AbortSignal
  onProgress?: (message: string) => void
}

export interface FollowResult {
  chatId: string
  status?: string
  busy: boolean
  done: boolean
  queued: boolean
  stalledQueue: boolean
  queuedMessageId?: string
  assistantText: string
  activity: EntryView[]
  pendingToolRequests: PendingRequestView[]
  cursor: number
  timedOut: boolean
  waitedMs: number
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hasOutputAfter(snapshot: ChatSnapshot, baseline: number): boolean {
  return snapshot.messages.some((entry) => entry.createdAt > baseline && entry.kind !== "user_prompt")
}

function isBusyStatus(status: string | undefined): boolean {
  return status !== undefined && BUSY_STATUSES.has(status)
}

function describeLatest(snapshot: ChatSnapshot): string {
  const latest = flattenEntries(snapshot.messages).at(-1)
  const status = snapshot.runtime.status
  if (!latest) return `Chat is ${status}`
  if (latest.kind === "tool_call") return `Running tool ${latest.toolName ?? "unknown"}`
  if (latest.kind === "assistant_text") return "Writing the reply"
  if (latest.kind === "pending_tool_request") return `Waiting for permission to run ${latest.toolName ?? "a tool"}`
  return `Chat is ${status}`
}

function baselineAfterQueue(host: SnapshotReader, chatId: string, previous: number, content: string | undefined): number {
  const entries = readChat(host, chatId, FINAL_RECENT_LIMIT)?.messages ?? []
  const prompt = entries.find((entry) => entry.kind === "user_prompt" && entry.createdAt > previous && (content === undefined || entry.content === content))
  return prompt ? prompt.createdAt : Math.max(previous, newestEntryTime(entries))
}

export function latestTurnBaseline(host: SnapshotReader, chatId: string): number {
  const entries = readChat(host, chatId, FINAL_RECENT_LIMIT)?.messages ?? []
  const lastPrompt = entries.filter((entry) => entry.kind === "user_prompt").at(-1)
  return lastPrompt ? lastPrompt.createdAt - 1 : 0
}

export async function dispatchSend(host: SendHost, command: SendCommand): Promise<SendOutcome> {
  const baseline = command.chatId ? newestEntryTime(readChat(host, command.chatId, STATUS_RECENT_LIMIT)?.messages ?? []) : 0
  const sent = await runCommand(host, command)
  if (!sent.ok) return { ok: false, message: sent.message }
  const chatId = stringFieldOf(sent.result, "chatId") ?? command.chatId
  if (chatId === undefined) return { ok: false, message: "The server did not report which chat received the message." }
  const queuedMessageId = stringFieldOf(sent.result, "queuedMessageId")
  return { ok: true, sent: { chatId, baseline, ...(queuedMessageId ? { queuedMessageId } : {}) } }
}

export async function followChat(host: ChatFollowHost, request: FollowRequest): Promise<FollowResult> {
  const { chatId, queuedMessageId } = request
  const pollIntervalMs = host.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const startedAt = Date.now()
  const deadline = startedAt + request.timeoutMs
  let baseline = request.baseline
  let waitingInQueue = queuedMessageId !== undefined
  let idleWithoutOutput = 0
  let reportedUpTo = baseline
  let lastReportAt = startedAt
  let deadlineHit = false

  function report(message: string) {
    lastReportAt = Date.now()
    request.onProgress?.(message)
  }

  for (;;) {
    if (request.signal?.aborted) break
    const snapshot = readChat(host, chatId, STATUS_RECENT_LIMIT)
    if (!snapshot) break
    const status = snapshot.runtime.status

    if (waitingInQueue && queuedMessageId !== undefined && !snapshot.queuedMessages.some((queued) => queued.id === queuedMessageId)) {
      waitingInQueue = false
      baseline = baselineAfterQueue(host, chatId, baseline, request.queuedContent)
      reportedUpTo = baseline
    }

    if (waitingInQueue) {
      if (status === WAITING_FOR_USER) break
      idleWithoutOutput = isBusyStatus(status) ? 0 : idleWithoutOutput + 1
      if (idleWithoutOutput >= IDLE_SETTLE_POLLS) break
      if (Date.now() - lastReportAt >= HEARTBEAT_MS) report("Message is queued behind the running turn")
    } else {
      const newest = newestEntryTime(snapshot.messages)
      if (newest > reportedUpTo) {
        reportedUpTo = newest
        report(describeLatest(snapshot))
      } else if (Date.now() - lastReportAt >= HEARTBEAT_MS) {
        report(`Still ${status}, ${Math.round((Date.now() - startedAt) / 1000)}s elapsed`)
      }
      if (!isBusyStatus(status)) {
        idleWithoutOutput = hasOutputAfter(snapshot, baseline) || status !== "idle" ? IDLE_SETTLE_POLLS : idleWithoutOutput + 1
        if (idleWithoutOutput >= IDLE_SETTLE_POLLS) break
      } else {
        idleWithoutOutput = 0
      }
    }

    if (Date.now() >= deadline) {
      deadlineHit = true
      break
    }
    await pause(pollIntervalMs)
  }

  const final = readChat(host, chatId, FINAL_RECENT_LIMIT)
  const entries = final?.messages ?? []
  const status = final?.runtime.status
  const queued = queuedMessageId !== undefined && (final?.queuedMessages.some((message) => message.id === queuedMessageId) ?? false)
  const busy = isBusyStatus(status) || queued
  const done = final === null || (!busy && status !== WAITING_FOR_USER)
  const stalledQueue = queued && !isBusyStatus(status) && status !== WAITING_FOR_USER
  const recent = entries.filter((entry) => entry.createdAt > baseline)
  return {
    chatId,
    status,
    busy,
    done,
    queued,
    stalledQueue,
    ...(queuedMessageId ? { queuedMessageId } : {}),
    assistantText: queued ? "" : assistantTextAfter(entries, baseline),
    activity: flattenEntries(recent)
      .slice(-ACTIVITY_LIMIT)
      .map((view) => (view.text === undefined ? view : { ...view, text: clipText(view.text, ACTIVITY_TEXT_CHARS) })),
    pendingToolRequests: pendingToolRequests(entries),
    cursor: Math.max(baseline, newestEntryTime(entries)),
    timedOut: deadlineHit && !done,
    waitedMs: Date.now() - startedAt,
  }
}
