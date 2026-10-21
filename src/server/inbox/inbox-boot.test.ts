import { expect, test } from "bun:test"
import type { InboundHandler } from "../../shared/inbound/handler"
import type { InboxThread } from "../../shared/inbox/types"
import type { McpSource } from "../../shared/mcp-sources/types"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { createInboxHarness } from "../test-helpers/inbox-harness"
import { inboxHandlerResolver, wireInboxPush } from "./inbox-boot"

function inbound(): BusEnvelope {
  return {
    v: 1,
    id: "env-1",
    subject: "kanna.webhook.hook1.delivery",
    ts: 100,
    source: { kind: "webhook", hookId: "hook1", hookName: "CI" },
    direction: "inbound",
    idempotencyKey: "webhook:hook1:d1",
    payload: { text: "hi" },
  }
}

const HANDLER: InboundHandler = {
  mode: "spawn",
  template: "",
  replyHint: "",
  pushEnabled: true,
}

const SOURCE_HANDLER: InboundHandler = { mode: "spawn", projectId: "p1", template: "t", replyHint: "use zalo_send_message", pushEnabled: true }

const SOURCE: McpSource = {
  id: "src-1",
  name: "Zalo",
  mode: "poll",
  serverId: "srv",
  enabled: true,
  threadKeyPath: "threadId",
  senderPath: "senderName",
  handler: SOURCE_HANDLER,
  tool: "zalo_get_messages",
  args: {},
  cursorArg: "since",
  cursorPath: "cursor",
  itemsPath: "messages",
  itemKeyPath: null,
  intervalMs: 15000,
  createdAt: 1,
  updatedAt: 1,
}

function thread(sourceKind: InboxThread["sourceKind"], sourceId: string): InboxThread {
  return {
    id: "t1",
    sourceKind,
    sourceId,
    sourceName: "x",
    threadKey: "k",
    sender: "s",
    messages: [],
    state: "new",
    unread: true,
    lastMessageAt: 1,
    replyCount: 0,
  }
}

async function escalatedThread(resolve: (thread: InboxThread) => InboundHandler | null) {
  const { inbox } = await createInboxHarness({ now: () => 200 })
  const pushed: string[] = []
  wireInboxPush(inbox, { notifyInbox: async (thread) => void pushed.push(thread.id) }, resolve)
  const thread = await inbox.ingestInbound(inbound(), { threadKey: "k1", sender: "ada", sourceName: "CI", deliveryId: "d1" })
  await inbox.bindChat(thread.id, "chat-1")
  await inbox.report(thread.id, "chat-1", "needs_you", "Pay it")
  return { pushed, threadId: thread.id }
}

test("a thread that turns needs_you is pushed when its source has no handler to consult", async () => {
  const { pushed, threadId } = await escalatedThread(() => null)
  expect(pushed).toEqual([threadId])
})

test("a thread whose source disabled push is not pushed", async () => {
  const { pushed } = await escalatedThread(() => ({ ...HANDLER, pushEnabled: false }))
  expect(pushed).toEqual([])
})

test("a reply on an MCP source's thread resolves that source's handler, and a webhook thread still resolves its hook", () => {
  const resolve = inboxHandlerResolver(
    { resolve: (id) => (id === "hook-1" ? { id, name: "CI", enabled: true, kind: "generic", mode: "notify", chatId: "c1", template: "build", createdAt: 1, updatedAt: 1, secret: "unused" } : null) },
    { sources: () => [SOURCE] },
  )

  expect(resolve(thread("mcp", "src-1"))?.replyHint).toBe("use zalo_send_message")
  expect(resolve(thread("mcp", "gone"))).toBeNull()
  expect(resolve(thread("webhook", "hook-1"))?.mode).toBe("notify")
  expect(resolve(thread("webhook", "gone"))).toBeNull()
})
