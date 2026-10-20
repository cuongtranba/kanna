import type { ServerContext } from "@modelcontextprotocol/server"
import type { ClientCommand } from "../../shared/protocol"
import { onRejected } from "../../shared/errors"
import { log } from "../../shared/log"
import type { ToolResult } from "../kanna-mcp-tool"
import { currentRemoteMcpOrigin } from "./remote-mcp-call-scope"
import type { DedupeRecord } from "./remote-mcp-dedupe"
import { followReport, resolveWaitLimit, type DuplicateVia } from "./remote-mcp-follow-view"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { guardedDispatch, type GuardedOutcome } from "./remote-mcp-send-guard"
import { jsonResult, runCommand, stringFieldOf } from "./remote-mcp-views"
import { dispatchSend, followChat, type SendCommand } from "./send-and-wait"

export type EnqueueCommand = Extract<ClientCommand, { type: "message.enqueue" }>

const MS_PER_SECOND = 1000
const UNKNOWN_CLIENT_ID = "unknown"

export function callerClientId(): string {
  return currentRemoteMcpOrigin()?.clientId ?? UNKNOWN_CLIENT_ID
}

function progressReporter(ctx: ServerContext): ((message: string) => void) | undefined {
  const progressToken = ctx.mcpReq._meta?.progressToken
  if (progressToken === undefined) return undefined
  let progress = 0
  return (message) => {
    progress += 1
    ctx.mcpReq
      .notify({ method: "notifications/progress", params: { progressToken, progress, message } })
      .catch(onRejected((error) => log.warn("[remote-mcp] progress notification failed", error.message)))
  }
}

export interface FollowReplyOptions {
  chatId: string
  baseline: number
  queuedMessageId?: string
  queuedContent?: string
  wait: boolean
  timeoutSeconds?: number
  duplicateVia?: DuplicateVia | null
}

export async function followReply(host: RemoteMcpHost, ctx: ServerContext, options: FollowReplyOptions): Promise<ToolResult> {
  const onProgress = progressReporter(ctx)
  const limit = options.wait
    ? resolveWaitLimit(options.timeoutSeconds, { era: host.era, streaming: onProgress !== undefined })
    : { seconds: 0 }
  const result = await followChat(host, {
    chatId: options.chatId,
    baseline: options.baseline,
    queuedMessageId: options.queuedMessageId,
    queuedContent: options.queuedContent,
    timeoutMs: limit.seconds * MS_PER_SECOND,
    signal: ctx.mcpReq.signal,
    onProgress,
  })
  return jsonResult(followReport(result, { duplicateVia: options.duplicateVia, clamp: limit.clamp }))
}

export function guardedChatSend(host: RemoteMcpHost, command: SendCommand, idempotencyKey?: string): Promise<GuardedOutcome> {
  return guardedDispatch(
    host,
    { scope: "send", clientId: callerClientId(), chatId: command.chatId, projectId: command.projectId, content: command.content },
    idempotencyKey,
    async () => {
      const outcome = await dispatchSend(host, command)
      return outcome.ok ? { ok: true, record: outcome.sent } : outcome
    },
  )
}

export async function guardedEnqueue(host: RemoteMcpHost, command: EnqueueCommand, idempotencyKey?: string): Promise<GuardedOutcome> {
  const { chatId, content } = command
  return guardedDispatch(
    host,
    { scope: "enqueue", clientId: callerClientId(), chatId, content },
    idempotencyKey,
    async () => {
      const outcome = await runCommand(host, command)
      if (!outcome.ok) return outcome
      const queuedMessageId = stringFieldOf(outcome.result, "queuedMessageId")
      return { ok: true, record: { chatId, baseline: 0, ...(queuedMessageId ? { queuedMessageId } : {}) } }
    },
  )
}

function acceptedNext(queued: boolean, duplicateVia: DuplicateVia | null): string {
  if (duplicateVia !== null) {
    return "Kanna already has this exact request (duplicate suppressed; nothing new was queued or started). Call wait_for_chat with this chatId to follow it."
  }
  if (queued) {
    return "The message is queued and runs when the chat is idle. Do NOT send it again. Call wait_for_chat with this chatId to follow it."
  }
  return "The message was accepted. Call wait_for_chat with this chatId to follow it."
}

export function acceptedReport(record: DedupeRecord, duplicateVia: DuplicateVia | null): ToolResult {
  const queued = record.queuedMessageId !== undefined
  return jsonResult({
    chatId: record.chatId,
    ...(queued ? { queued: true, queuedMessageId: record.queuedMessageId } : {}),
    ...(duplicateVia === null ? {} : { duplicate: true, duplicateOf: record.chatId, duplicateVia }),
    next: acceptedNext(queued, duplicateVia),
  })
}
