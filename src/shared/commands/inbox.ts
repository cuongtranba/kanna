import { z } from "zod"
import { defineCommand, defineCommands, REMOTE_ALLOWED, remoteExcluded } from "./define"
import { idParams } from "./fragments"
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
import { okResultSchema } from "./results/common"

const WEBHOOK_SECRET_REASON =
  "A webhook secret is a credential: create and rotateSecret return it once and the hook accepts anything signed with it, so a remote client could mint or read a credential. Webhook management stays in the browser UI."

const threadTextParams = z.object({ threadId: z.string(), text: z.string() })

export const inboxCommands = defineCommands(
  defineCommand("inbox.markRead", {
    result: okResultSchema,
    params: z.object({ ids: z.array(z.string()) }),
    summary: "Mark inbox threads or activity items as read.",
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
    params: z.object({ threadId: z.string() }),
    summary: "Archive an inbox thread so it leaves the Inbox tab.",
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
    result: chatIdResultSchema,
    params: threadTextParams,
    summary: "Send a reply to an inbox thread through its handler chat and source tools.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("inbox.instruct", {
    result: chatIdResultSchema,
    params: threadTextParams,
    summary: "Tell an inbox thread's handler chat what to do and ask it to report a fresh draft.",
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
