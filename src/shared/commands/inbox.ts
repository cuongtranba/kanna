import { z } from "zod"
import { defineCommand, defineCommands, REMOTE_ALLOWED, remoteExcluded } from "./define"
import { idParams } from "./fragments"
import { INBOX_AUTONOMY_LEVELS } from "../inbox/autonomy"
import { inboxFilterSchema, inboxPageSchema } from "../inbox/types.schema"
import {
  createdWebhookSchema,
  deletedWebhookSchema,
  rotatedWebhookSecretSchema,
  updatedWebhookSchema,
  webhookInputSchema,
  webhookPatchSchema,
} from "../webhooks/types.schema"
import { chatIdResultSchema } from "./results/chat"
import { inboxOutboundIdResultSchema, inboxReplyResultSchema } from "./results/inbox"
import { okResultSchema } from "./results/common"

const WEBHOOK_SECRET_REASON =
  "A webhook secret is a credential: create and rotateSecret return it once and the hook accepts anything signed with it, so a remote client could mint or read a credential. Webhook management stays in the browser UI."

const threadTextParams = z.object({ threadId: z.string(), text: z.string() })
const proposalParams = z.object({ threadId: z.string(), proposalId: z.string() })

export const inboxCommands = defineCommands(
  defineCommand("inbox.markRead", {
    result: okResultSchema,
    params: z.object({ ids: z.array(z.string()) }),
    summary: "Mark inbox threads or activity items as read.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.markUnread", {
    result: okResultSchema,
    params: z.object({ ids: z.array(z.string()) }),
    summary: "Mark inbox threads or activity items as unread again.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.markAllRead", {
    result: okResultSchema,
    params: z.object({ beforeTs: z.number().optional() }),
    summary: "Mark every inbox thread and activity item up to a time as read.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.archive", {
    result: okResultSchema,
    params: z.object({ threadId: z.string().optional(), threadIds: z.array(z.string()).optional() }),
    summary: "Archive one inbox thread (threadId) or several at once (threadIds) so they leave the Inbox tab.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.unarchive", {
    result: okResultSchema,
    params: z.object({ threadId: z.string() }),
    summary: "Restore an archived inbox thread to the state and read status it had before it was archived.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.muteSender", {
    result: okResultSchema,
    params: z.object({ threadId: z.string(), muted: z.boolean() }),
    summary: "Mute or unmute an inbox thread's sender on its source so their messages are recorded without being handled.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.page", {
    result: inboxPageSchema,
    params: z.object({ beforeTs: z.number(), limit: z.number(), filter: inboxFilterSchema.optional() }),
    summary: "Read a page of inbox threads and activity items older than a time.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.reply", {
    result: inboxReplyResultSchema,
    params: threadTextParams,
    summary: "Send a reply to an inbox thread: directly through its source's reply tool when it has one, otherwise through its handler chat.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.retrySend", {
    result: inboxOutboundIdResultSchema,
    params: z.object({ threadId: z.string(), outboundId: z.string(), confirmDuplicate: z.boolean().optional() }),
    summary: "Send an inbox reply that failed again as a new message; one that may already have been delivered needs confirmDuplicate.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.instruct", {
    result: chatIdResultSchema,
    params: threadTextParams.extend({ draft: z.string().optional() }),
    summary: "Ask an inbox thread's handler chat to write or rewrite a reply draft from an instruction and the current draft; nothing is sent to the sender.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.approveProposal", {
    result: inboxOutboundIdResultSchema,
    params: proposalParams.extend({ text: z.string().optional() }),
    summary: "Send the agent's open reply proposal to the sender, optionally with edited text; this also pauses the agent on the thread.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.rejectProposal", {
    result: okResultSchema,
    params: proposalParams,
    summary: "Reject the agent's open reply proposal without sending anything.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.cancelProposal", {
    result: okResultSchema,
    params: proposalParams,
    summary: "Undo an auto-send that is waiting out its delay so nothing is sent.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.setThreadAutonomy", {
    result: okResultSchema,
    params: z.object({ threadId: z.string(), level: z.enum(INBOX_AUTONOMY_LEVELS).nullable() }),
    summary: "Override the autonomy level of one inbox thread, or pass null to use the source default.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.resumeAgent", {
    result: okResultSchema,
    params: z.object({ threadId: z.string() }),
    summary: "Let the agent act on an inbox thread again after a human reply paused it.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("webhooks.create", {
    result: createdWebhookSchema,
    params: z.object({ input: webhookInputSchema }),
    summary: "Create an inbound webhook and return its secret once.",
    risk: "write",
    remote: remoteExcluded(WEBHOOK_SECRET_REASON),
  }),
  defineCommand("webhooks.update", {
    result: updatedWebhookSchema,
    params: z.object({ id: z.string(), patch: webhookPatchSchema }),
    summary: "Edit or enable or disable an inbound webhook.",
    risk: "write",
    remote: remoteExcluded(WEBHOOK_SECRET_REASON),
  }),
  defineCommand("webhooks.delete", {
    result: deletedWebhookSchema,
    params: idParams,
    summary: "Delete an inbound webhook.",
    risk: "destructive",
    remote: remoteExcluded(WEBHOOK_SECRET_REASON),
  }),
  defineCommand("webhooks.rotateSecret", {
    result: rotatedWebhookSecretSchema,
    params: idParams,
    summary: "Replace an inbound webhook's secret and return the new one once.",
    risk: "write",
    remote: remoteExcluded(WEBHOOK_SECRET_REASON),
  }),
)
