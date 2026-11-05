import type { JsonObject, JsonValue } from "../../shared/json"
import { toError } from "../../shared/errors"
import { resolveReplyArgs } from "../../shared/inbound/reply-args"
import { inboxReplyTextError, outboundRetryState } from "../../shared/inbox/policy"
import type { InboxOutboundBy, InboxOutboundProvenance, InboxThread } from "../../shared/inbox/types"
import { log } from "../../shared/log"
import type { McpSourceReply } from "../../shared/mcp-sources/types"
import { textAt } from "../mcp-sources/mcp-source-fetch"
import { McpSourceUnavailableError, McpToolRejectedError } from "../mcp-sources/mcp-source-runner"
import type { InboxOutboundOutcome, InboxRegistry } from "./inbox-registry"

export interface OutboxSource {
  id: string
  reply: McpSourceReply
}

export type OutboxSourceResolver = (thread: InboxThread) => OutboxSource | null

export type InboxSendResult = { ok: true; outboundId: string } | { ok: false; error: string }

export interface InboxOutboxOptions {
  registry: Pick<InboxRegistry, "getThread" | "queueOutbound" | "settleOutbound">
  resolveSource: OutboxSourceResolver
  callTool(sourceId: string, name: string, args: JsonObject): Promise<JsonValue>
  rememberKey(sourceId: string, key: string): void
  ids?: () => string
}

export interface InboxOutbox {
  hasReplyTarget(threadId: string): boolean
  send(threadId: string, text: string, by: InboxOutboundBy, proposal?: InboxOutboundProvenance): Promise<InboxSendResult>
  retry(threadId: string, outboundId: string, confirmDuplicate: boolean): Promise<InboxSendResult>
}

function classify(error: Error): InboxOutboundOutcome {
  const rejected = error instanceof McpToolRejectedError || error instanceof McpSourceUnavailableError
  return { status: rejected ? "failed" : "unknown", error: error.message }
}

export function createInboxOutbox(options: InboxOutboxOptions): InboxOutbox {
  const { registry, resolveSource, callTool, rememberKey } = options
  const newId = options.ids ?? (() => crypto.randomUUID())

  function targetOf(threadId: string): { thread: InboxThread; source: OutboxSource } | string {
    const thread = registry.getThread(threadId)
    if (!thread) return `Unknown inbox thread ${threadId}`
    const source = resolveSource(thread)
    return source ? { thread, source } : "This thread's source has no reply target"
  }

  async function deliver(threadId: string, outboundId: string, source: OutboxSource, args: JsonObject): Promise<void> {
    let outcome: InboxOutboundOutcome
    try {
      const result = await callTool(source.id, source.reply.tool, args)
      const resultId = textAt(result, source.reply.resultIdPath)
      if (resultId.length > 0) rememberKey(source.id, resultId)
      outcome = resultId.length > 0 ? { status: "sent", resultId } : { status: "sent" }
    } catch (error) {
      outcome = classify(toError(error))
    }
    await registry.settleOutbound(threadId, outboundId, outcome)
  }

  function fire(threadId: string, outboundId: string, source: OutboxSource, args: JsonObject): void {
    deliver(threadId, outboundId, source, args).catch((error) => {
      log.warn("[inbox-outbox] settle failed:", toError(error))
    })
  }

  async function enqueue(
    threadId: string,
    text: string,
    by: InboxOutboundBy,
    proposal: InboxOutboundProvenance | undefined,
    retryOf: string | null,
  ): Promise<InboxSendResult> {
    const body = text.trim()
    const invalid = inboxReplyTextError(body)
    if (invalid !== null) return { ok: false, error: invalid }
    const target = targetOf(threadId)
    if (typeof target === "string") return { ok: false, error: target }
    const { thread, source } = target
    const outboundId = newId()
    const resolved = resolveReplyArgs(source.reply, thread.messages.at(-1)?.payload ?? null, body)
    await registry.queueOutbound(threadId, {
      id: outboundId,
      text: body,
      by,
      ...(proposal === undefined ? {} : { proposal }),
      ...(retryOf === null ? {} : { retryOf }),
    })
    if (resolved.ok) fire(threadId, outboundId, source, resolved.args)
    else await registry.settleOutbound(threadId, outboundId, { status: "failed", error: resolved.error })
    return { ok: true, outboundId }
  }

  function send(threadId: string, text: string, by: InboxOutboundBy, proposal?: InboxOutboundProvenance): Promise<InboxSendResult> {
    return enqueue(threadId, text, by, proposal, null)
  }

  async function retry(threadId: string, outboundId: string, confirmDuplicate: boolean): Promise<InboxSendResult> {
    const thread = registry.getThread(threadId)
    if (!thread) return { ok: false, error: `Unknown inbox thread ${threadId}` }
    const state = outboundRetryState(thread, outboundId)
    if (state.kind === "refused") return { ok: false, error: state.reason }
    if (state.kind === "needs_confirm" && !confirmDuplicate) {
      return { ok: false, error: "This message may already have been delivered; confirm to send it again" }
    }
    const outbound = thread.outbound.find((candidate) => candidate.id === outboundId)
    if (!outbound) return { ok: false, error: "Unknown outbound message" }
    return enqueue(threadId, outbound.text, outbound.by, outbound.proposal, outboundId)
  }

  return {
    hasReplyTarget: (threadId) => typeof targetOf(threadId) !== "string",
    send,
    retry,
  }
}
