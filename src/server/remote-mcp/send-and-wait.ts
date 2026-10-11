import type { ClientCommand } from "../../shared/protocol"
import { isJsonObject, type JsonValue } from "../../shared/json"
import type { ChatSnapshot } from "../../shared/types"
import {
  assistantTextAfter,
  newestEntryTime,
  pendingToolRequests,
  readChat,
  runCommand,
  type CommandRunner,
  type PendingRequestView,
  type SnapshotReader,
} from "./remote-mcp-views"

const DEFAULT_POLL_INTERVAL_MS = 500
const STATUS_RECENT_LIMIT = 20
const FINAL_RECENT_LIMIT = 200
const IDLE_SETTLE_POLLS = 3
const BUSY_STATUSES: ReadonlySet<string> = new Set(["starting", "running"])

export type SendCommand = Extract<ClientCommand, { type: "chat.send" }>

export interface SendAndWaitHost extends CommandRunner, SnapshotReader {
  pollIntervalMs?: number
}

export interface SendAndWaitRequest {
  command: SendCommand
  wait: boolean
  timeoutMs: number
}

export type SendAndWaitOutcome =
  | { ok: false; message: string }
  | {
      ok: true
      chatId: string
      status?: string
      assistantText?: string
      pendingToolRequests?: PendingRequestView[]
      timedOut?: boolean
    }

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function chatIdOf(result: JsonValue): string | null {
  if (!isJsonObject(result)) return null
  const chatId = result.chatId
  return typeof chatId === "string" ? chatId : null
}

function hasOutputAfter(snapshot: ChatSnapshot, baseline: number): boolean {
  return snapshot.messages.some((entry) => entry.createdAt > baseline && entry.kind !== "user_prompt")
}

export async function sendAndWait(host: SendAndWaitHost, request: SendAndWaitRequest): Promise<SendAndWaitOutcome> {
  const { command } = request
  const baseline = command.chatId ? newestEntryTime(readChat(host, command.chatId, STATUS_RECENT_LIMIT)?.messages ?? []) : 0
  const sent = await runCommand(host, command)
  if (!sent.ok) return { ok: false, message: sent.message }
  const chatId = chatIdOf(sent.result) ?? command.chatId ?? null
  if (chatId === null) return { ok: false, message: "The server did not report which chat received the message." }
  if (!request.wait) return { ok: true, chatId }

  const pollIntervalMs = host.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const deadline = Date.now() + request.timeoutMs
  let idleWithoutOutput = 0
  let timedOut = false
  for (;;) {
    const snapshot = readChat(host, chatId, STATUS_RECENT_LIMIT)
    const status = snapshot?.runtime.status
    if (snapshot && status !== undefined && !BUSY_STATUSES.has(status)) {
      idleWithoutOutput = hasOutputAfter(snapshot, baseline) || status !== "idle" ? IDLE_SETTLE_POLLS : idleWithoutOutput + 1
      if (idleWithoutOutput >= IDLE_SETTLE_POLLS) break
    } else {
      idleWithoutOutput = 0
    }
    if (Date.now() >= deadline) {
      timedOut = true
      break
    }
    await pause(pollIntervalMs)
  }

  const final = readChat(host, chatId, FINAL_RECENT_LIMIT)
  const entries = final?.messages ?? []
  return {
    ok: true,
    chatId,
    status: final?.runtime.status,
    assistantText: assistantTextAfter(entries, baseline),
    pendingToolRequests: pendingToolRequests(entries),
    timedOut,
  }
}
