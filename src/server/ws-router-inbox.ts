import { inboxReplyTextError } from "../shared/inbox/policy"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import { ackResult } from "./ws-router-ack"
import type { InboxReplyResult } from "./inbound/inbox-reply"
import type { InboxRegistry } from "./inbox/inbox-registry"
import type { InboxProposalAck } from "./inbox/inbox-autopilot"
import type { InboxSnoozeResult } from "./inbox/inbox-registry"
import type { InboxSendResult } from "./inbox/inbox-outbox"

export type InboxReplyOutcome =
  | { ok: true; mode: "direct"; outboundId: string }
  | { ok: true; mode: "agent"; chatId: string }
  | { ok: false; error: string }

export type InboxReplyAction = (threadId: string, text: string) => Promise<InboxReplyOutcome>
export type InboxInstructAction = (threadId: string, text: string, draft?: string) => Promise<InboxReplyResult>
export type InboxRetrySendAction = (threadId: string, outboundId: string, confirmDuplicate: boolean) => Promise<InboxSendResult>

export interface InboxActions {
  reply: InboxReplyAction
  instruct: InboxInstructAction
  retrySend: InboxRetrySendAction
  approveProposal: (threadId: string, proposalId: string, text?: string) => Promise<InboxSendResult>
  rejectProposal: (threadId: string, proposalId: string) => Promise<InboxProposalAck>
  cancelProposal: (threadId: string, proposalId: string) => Promise<InboxProposalAck>
}

const PAGE_LIMIT_MAX = 200
const PAGE_LIMIT_DEFAULT = 50

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return PAGE_LIMIT_DEFAULT
  return Math.min(PAGE_LIMIT_MAX, Math.max(1, Math.floor(value)))
}

function requireText(text: string): string {
  const trimmed = text.trim()
  const invalid = inboxReplyTextError(trimmed)
  if (invalid !== null) throw new Error(invalid)
  return trimmed
}

function requireId(value: string, name: string): string {
  if (value.length === 0) throw new Error(`${name} is required`)
  return value
}

function unwrapChat(result: InboxReplyResult): { chatId: string } {
  if (!result.ok) throw new Error(result.error)
  return { chatId: result.chatId }
}

function unwrapReply(result: InboxReplyOutcome): { mode: "direct"; outboundId: string } | { mode: "agent"; chatId: string } {
  if (!result.ok) throw new Error(result.error)
  return result.mode === "direct" ? { mode: "direct", outboundId: result.outboundId } : { mode: "agent", chatId: result.chatId }
}

function unwrapSend(result: InboxSendResult): { outboundId: string } {
  if (!result.ok) throw new Error(result.error)
  return { outboundId: result.outboundId }
}

function unwrapAck(result: InboxProposalAck | InboxSnoozeResult): { ok: true } {
  if (!result.ok) throw new Error(result.error)
  return { ok: true }
}

async function run(
  registry: InboxRegistry,
  actions: InboxActions,
  command: ClientCommand,
  id: string,
): Promise<ServerEnvelope | null> {
  switch (command.type) {
    case "inbox.markRead":
      await registry.markRead(command.ids)
      return ackResult(id, command, { ok: true })
    case "inbox.markUnread":
      await registry.markUnread(command.ids)
      return ackResult(id, command, { ok: true })
    case "inbox.markAllRead":
      await registry.markAllRead(command.beforeTs)
      return ackResult(id, command, { ok: true })
    case "inbox.archive": {
      const threadIds = [...(command.threadId === undefined ? [] : [command.threadId]), ...(command.threadIds ?? [])]
      if (threadIds.length === 0) throw new Error("threadId or threadIds is required")
      for (const threadId of new Set(threadIds)) await registry.archive(requireId(threadId, "threadId"))
      return ackResult(id, command, { ok: true })
    }
    case "inbox.unarchive":
      await registry.unarchive(requireId(command.threadId, "threadId"))
      return ackResult(id, command, { ok: true })
    case "inbox.snooze": {
      const threadIds = [...new Set(command.threadIds.map((threadId) => requireId(threadId, "threadId")))]
      if (threadIds.length === 0) throw new Error("threadIds is required")
      return ackResult(id, command, unwrapAck(await registry.snooze(threadIds, command.until)))
    }
    case "inbox.unsnooze":
      await registry.unsnooze(requireId(command.threadId, "threadId"))
      return ackResult(id, command, { ok: true })
    case "inbox.muteSender":
      await registry.setSenderMuted(requireId(command.threadId, "threadId"), command.muted)
      return ackResult(id, command, { ok: true })
    case "inbox.page":
      return ackResult(id, command, registry.page(
        command.beforeTs,
        clampLimit(command.limit),
        command.filter ?? {},
      ))
    case "inbox.reply":
      return ackResult(id, command, unwrapReply(await actions.reply(requireId(command.threadId, "threadId"), requireText(command.text))))
    case "inbox.retrySend":
      return ackResult(id, command, unwrapSend(await actions.retrySend(
        requireId(command.threadId, "threadId"),
        requireId(command.outboundId, "outboundId"),
        command.confirmDuplicate === true,
      )))
    case "inbox.approveProposal":
      return ackResult(id, command, unwrapSend(await actions.approveProposal(
        requireId(command.threadId, "threadId"),
        requireId(command.proposalId, "proposalId"),
        command.text === undefined ? undefined : requireText(command.text),
      )))
    case "inbox.rejectProposal":
      return ackResult(id, command, unwrapAck(await actions.rejectProposal(
        requireId(command.threadId, "threadId"),
        requireId(command.proposalId, "proposalId"),
      )))
    case "inbox.cancelProposal":
      return ackResult(id, command, unwrapAck(await actions.cancelProposal(
        requireId(command.threadId, "threadId"),
        requireId(command.proposalId, "proposalId"),
      )))
    case "inbox.setThreadAutonomy":
      await registry.setThreadAutonomy(requireId(command.threadId, "threadId"), command.level)
      return ackResult(id, command, { ok: true })
    case "inbox.resumeAgent":
      await registry.pauseAgent(requireId(command.threadId, "threadId"), null)
      return ackResult(id, command, { ok: true })
    case "inbox.instruct":
      return ackResult(id, command, unwrapChat(await actions.instruct(
        requireId(command.threadId, "threadId"),
        requireText(command.text),
        command.draft,
      )))
    default:
      return null
  }
}

export async function handleInboxCommand(
  registry: InboxRegistry | undefined,
  actions: InboxActions | undefined,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  if (!command.type.startsWith("inbox.")) return false
  if (!registry || !actions) throw new Error("The inbox is not available on this server")
  const envelope = await run(registry, actions, command, id)
  if (envelope === null) return false
  send(envelope)
  return true
}
