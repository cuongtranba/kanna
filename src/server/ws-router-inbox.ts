import { INBOX_REPLY_MAX_CHARS } from "../shared/inbox/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import { ackResult } from "./ws-router-ack"
import type { InboxReplyResult } from "./inbound/inbox-reply"
import type { InboxRegistry } from "./inbox/inbox-registry"

export type InboxReplyAction = (threadId: string, text: string) => Promise<InboxReplyResult>

const PAGE_LIMIT_MAX = 200
const PAGE_LIMIT_DEFAULT = 50

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return PAGE_LIMIT_DEFAULT
  return Math.min(PAGE_LIMIT_MAX, Math.max(1, Math.floor(value)))
}

function requireText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new Error("Text is required")
  if (trimmed.length > INBOX_REPLY_MAX_CHARS) throw new Error(`Text must be at most ${INBOX_REPLY_MAX_CHARS} characters`)
  return trimmed
}

function requireId(value: string, name: string): string {
  if (value.length === 0) throw new Error(`${name} is required`)
  return value
}

function unwrap(result: InboxReplyResult): { chatId: string } {
  if (!result.ok) throw new Error(result.error)
  return { chatId: result.chatId }
}

async function run(
  registry: InboxRegistry,
  reply: InboxReplyAction,
  instruct: InboxReplyAction,
  command: ClientCommand,
  id: string,
): Promise<ServerEnvelope | null> {
  switch (command.type) {
    case "inbox.markRead":
      await registry.markRead(command.ids)
      return ackResult(id, command, { ok: true })
    case "inbox.markAllRead":
      await registry.markAllRead(command.beforeTs)
      return ackResult(id, command, { ok: true })
    case "inbox.archive":
      await registry.archive(requireId(command.threadId, "threadId"))
      return ackResult(id, command, { ok: true })
    case "inbox.page":
      return ackResult(id, command, registry.page(
        command.beforeTs,
        clampLimit(command.limit),
        command.filter ?? {},
      ))
    case "inbox.reply":
      return ackResult(id, command, unwrap(await reply(requireId(command.threadId, "threadId"), requireText(command.text))))
    case "inbox.instruct":
      return ackResult(id, command, unwrap(await instruct(requireId(command.threadId, "threadId"), requireText(command.text))))
    default:
      return null
  }
}

export async function handleInboxCommand(
  registry: InboxRegistry | undefined,
  reply: InboxReplyAction | undefined,
  instruct: InboxReplyAction | undefined,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  if (!command.type.startsWith("inbox.")) return false
  if (!registry || !reply || !instruct) throw new Error("The inbox is not available on this server")
  const envelope = await run(registry, reply, instruct, command, id)
  if (envelope === null) return false
  send(envelope)
  return true
}
