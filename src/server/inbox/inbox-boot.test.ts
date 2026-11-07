import { INBOX_TAKEOVER_PAUSE_MS, MCP_SOURCE_AUTONOMY_DEFAULTS } from "../../shared/inbox/autonomy"
import { expect, test } from "vite-plus/test"
import type { InboundHandler } from "../../shared/inbound/handler"
import type { InboxThread } from "../../shared/inbox/types"
import type { McpSource } from "../../shared/mcp-sources/types"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import type { JsonObject } from "../../shared/json"
import type { McpSourceReply } from "../../shared/mcp-sources/types"
import { deliverInbound } from "../inbound/deliver-inbound"
import { createInboxHarness } from "../test-helpers/inbox-harness"
import { waitFor } from "../test-helpers/wait-for"
import { createWebhookHarness } from "../test-helpers/webhook-harness"
import { createInboxReplyActions, inboxHandlerResolver, mcpOutboxSourceResolver, wireInboxAutopilot, wireInboxPush } from "./inbox-boot"
import { createFakeAutopilotClock } from "../test-helpers/autopilot-clock"
import { createInboxOutbox } from "./inbox-outbox"

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
  textPath: "",
  handler: SOURCE_HANDLER,
  reply: null,
  tool: "zalo_get_messages",
  args: {},
  cursorArg: "since",
  cursorPath: "cursor",
  itemsPath: "messages",
  itemKeyPath: null,
  intervalMs: 15000,
  autonomy: MCP_SOURCE_AUTONOMY_DEFAULTS,
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
    outbound: [],
    drafts: [],
    state: "new",
    unread: true,
    lastMessageAt: 1,
    replyCount: 0,
    muted: false,
  }
}

async function escalatedThread(resolve: (thread: InboxThread) => InboundHandler | null) {
  const { inbox } = await createInboxHarness({ now: () => 200 })
  const pushed: string[] = []
  wireInboxPush(inbox, { notifyInbox: async (thread) => void pushed.push(thread.id), notifyInboxProposal: async () => {} }, resolve, () => null)
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

const ZALO_REPLY: McpSourceReply = { tool: "zalo_send_message", args: { threadId: "{{message.threadId}}", text: "{{reply.text}}" }, resultIdPath: "" }

async function routedThread(options: { reply: McpSourceReply | null; mode: "notify" | "inline"; kind: "mcp" | "webhook" }) {
  const harness = await createWebhookHarness()
  const handler: InboundHandler = { mode: options.mode, chatId: harness.chat.id, template: "t", replyHint: "", pushEnabled: true }
  const result = await deliverInbound(harness.store, harness.agent, harness.bus, harness.inbox, {
    source: options.kind === "mcp"
      ? { kind: "mcp", sourceId: "src-1", sourceName: "Zalo", serverId: "srv", serverName: "zalo-mcp" }
      : { kind: "webhook", hookId: "hook-1", hookName: "CI" },
    sourceName: "Zalo",
    handler,
    deliveryId: "d1",
    body: { threadId: "t-9" },
    threadKey: "t-9",
    sender: "An",
    at: 10,
  })
  if (!result.ok) throw new Error(result.detail)
  const calls: JsonObject[] = []
  const source: McpSource = { ...SOURCE, reply: options.reply }
  const outbox = createInboxOutbox({
    registry: harness.inbox,
    resolveSource: mcpOutboxSourceResolver({ sources: () => [source] }),
    callTool: async (_sourceId, _name, args) => { calls.push(args); return {} },
    rememberKey: () => {},
  })
  const autopilot = wireInboxAutopilot(harness.inbox, outbox, { sources: () => [source] }, createFakeAutopilotClock(0))
  const { inboxActions } = createInboxReplyActions(harness.store, harness.agent, harness.inbox, () => handler, outbox, autopilot)
  return { ...harness, inboxActions, calls, threadId: result.threadId }
}

test("a reply on an MCP source with a reply target is sent directly, even in Notify mode", async () => {
  const { inboxActions, inbox, calls, threadId } = await routedThread({ reply: ZALO_REPLY, mode: "notify", kind: "mcp" })

  const result = await inboxActions.reply(threadId, "hello")

  expect(result).toMatchObject({ ok: true, mode: "direct" })
  await waitFor(() => inbox.getThread(threadId)?.state === "replied")
  expect(calls).toEqual([{ threadId: "t-9", text: "hello" }])
})

test("a Notify thread whose source has no reply target is still refused on the agent path", async () => {
  const { inboxActions, calls, threadId } = await routedThread({ reply: null, mode: "notify", kind: "mcp" })
  expect(await inboxActions.reply(threadId, "hello")).toEqual({ ok: false, error: "This thread has no handler chat" })
  expect(calls).toEqual([])
})

test("a webhook thread keeps the agent path and has no outbound message to retry", async () => {
  const hook = await routedThread({ reply: ZALO_REPLY, mode: "inline", kind: "webhook" })
  expect(await hook.inboxActions.reply(hook.threadId, "hello")).toEqual({ ok: true, mode: "agent", chatId: hook.chat.id })
  expect(hook.calls).toEqual([])

  const refused = await hook.inboxActions.retrySend(hook.threadId, "ghost", false)
  expect(refused.ok).toBe(false)
})

test("a direct send by you pauses the agent on that thread, and resuming clears it", async () => {
  const { inboxActions, inbox, threadId } = await routedThread({ reply: ZALO_REPLY, mode: "notify", kind: "mcp" })
  expect(inbox.getThread(threadId)?.agentPausedUntil).toBeUndefined()

  await inboxActions.reply(threadId, "hello")

  expect(inbox.getThread(threadId)?.agentPausedUntil).toBe(INBOX_TAKEOVER_PAUSE_MS)
  await inbox.pauseAgent(threadId, null)
  expect(inbox.getThread(threadId)?.agentPausedUntil).toBeUndefined()
})

test("approving a proposal through the actions sends it as approved with its provenance", async () => {
  const { inboxActions, inbox, calls, threadId } = await routedThread({ reply: ZALO_REPLY, mode: "notify", kind: "mcp" })
  await inbox.addProposal(threadId, { id: "p1", text: "Friday", confidence: 0.7, reason: "invoice", at: 1, status: "open" })

  const result = await inboxActions.approveProposal(threadId, "p1", "Next Friday")

  expect(result.ok).toBe(true)
  await waitFor(() => inbox.getThread(threadId)?.outbound[0]?.status === "sent")
  expect(calls).toEqual([{ threadId: "t-9", text: "Next Friday" }])
  expect(inbox.getThread(threadId)?.outbound[0]).toMatchObject({ by: "approved", proposal: { id: "p1", confidence: 0.7, reason: "invoice" } })
  expect(inbox.getThread(threadId)?.proposal).toBeUndefined()
})
