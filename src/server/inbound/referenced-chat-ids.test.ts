import { expect, test } from "vite-plus/test"
import type { McpPollSource } from "../../shared/mcp-sources/types"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { createInboxHarness } from "../test-helpers/inbox-harness"
import { createMemoryWebhookStore } from "../test-helpers/webhook-harness"
import { WebhookRegistry } from "../webhooks/webhook-registry"
import { createReferencedChatIds } from "./referenced-chat-ids"

const SOURCE: McpPollSource = {
  id: "poll",
  name: "Zalo",
  mode: "poll",
  serverId: "srv",
  enabled: true,
  threadKeyPath: "threadId",
  senderPath: "senderName",
  textPath: "",
  reply: null,
  handler: { mode: "notify", chatId: "source-chat", template: "t", replyHint: "", pushEnabled: true },
  tool: "zalo_get_messages",
  args: {},
  cursorArg: "since",
  cursorPath: "cursor",
  itemsPath: "messages",
  itemKeyPath: "messageId",
  intervalMs: 10_000,
  createdAt: 1,
  updatedAt: 1,
}

const DELIVERY: BusEnvelope = {
  v: 1,
  id: "env-1",
  subject: "kanna.webhook.hook1.delivery",
  ts: 1,
  source: { kind: "webhook", hookId: "hook1", hookName: "CI" },
  direction: "inbound",
  idempotencyKey: "webhook:hook1:d1",
  payload: { text: "hi" },
}

test("collects the chats that sources, webhooks and inbox threads point at", async () => {
  const { inbox } = await createInboxHarness()
  const thread = await inbox.ingestInbound(DELIVERY, { threadKey: "k", sender: "ada", sourceName: "CI", deliveryId: "d1" })
  await inbox.bindChat(thread.id, "thread-chat")
  await inbox.escalate(thread.id, "report-chat")
  const webhooks = new WebhookRegistry(createMemoryWebhookStore())
  await webhooks.create({ name: "CI", mode: "notify", chatId: "hook-chat", template: "t" })
  await webhooks.create({ name: "Spawn", mode: "spawn", projectId: "p1", template: "t" })
  const noChatSource: McpPollSource = { ...SOURCE, id: "other", handler: { ...SOURCE.handler, chatId: undefined, mode: "spawn", projectId: "p1" } }

  const referenced = createReferencedChatIds({ mcpSources: { sources: () => [SOURCE, noChatSource] }, webhooks, inbox })

  expect([...referenced()].sort()).toEqual(["hook-chat", "report-chat", "source-chat", "thread-chat"])
})
