import { expect, test } from "vite-plus/test"
import type { JsonObject, JsonValue } from "../../shared/json"
import type { InboxThread } from "../../shared/inbox/types"
import type { McpSourceReply } from "../../shared/mcp-sources/types"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { McpSourceUnavailableError, McpToolRejectedError } from "../mcp-sources/mcp-source-runner"
import { deliverInbound } from "../inbound/deliver-inbound"
import { createInboxHarness } from "../test-helpers/inbox-harness"
import { createWebhookHarness } from "../test-helpers/webhook-harness"
import { waitFor } from "../test-helpers/wait-for"
import { createInboxOutbox } from "./inbox-outbox"
import { InboxRegistry } from "./inbox-registry"

const REPLY: McpSourceReply = {
  tool: "zalo_send_message",
  args: {
    threadId: "{{message.threadId}}",
    threadType: { from: "message.threadType", map: { dm: 0, group: 1 } },
    text: "{{reply.text}}",
  },
  resultIdPath: "msgId",
}

const MESSAGE: JsonObject = { threadId: "t-9", threadType: "group", text: "hello" }

function inbound(): BusEnvelope {
  return {
    v: 1,
    id: "env-1",
    subject: "kanna.mcp.zalo.item",
    ts: 100,
    source: { kind: "mcp", sourceId: "zalo", sourceName: "Zalo", serverId: "srv", serverName: "zalo-mcp" },
    direction: "inbound",
    idempotencyKey: "mcp:zalo:d1",
    payload: MESSAGE,
  }
}

type ToolBehavior = (args: JsonObject) => Promise<JsonValue>

function createFakeTool() {
  const tool = {
    calls: [] as { sourceId: string; name: string; args: JsonObject }[],
    keys: [] as string[],
    behavior: (async () => ({ msgId: "m-1" })) as ToolBehavior,
    callTool(sourceId: string, name: string, args: JsonObject): Promise<JsonValue> {
      tool.calls.push({ sourceId, name, args })
      return tool.behavior(args)
    },
    rememberKey(_sourceId: string, key: string): void {
      tool.keys.push(key)
    },
  }
  return tool
}

async function setup() {
  const { inbox, log } = await createInboxHarness({ now: () => 500 })
  const tool = createFakeTool()
  const outbox = createInboxOutbox({
    registry: inbox,
    resolveSource: () => ({ id: "zalo", reply: REPLY }),
    callTool: tool.callTool,
    rememberKey: tool.rememberKey,
  })
  const thread = await inbox.ingestInbound(inbound(), { threadKey: "t-9", sender: "An", sourceName: "Zalo", deliveryId: "d1" })
  const read = (): InboxThread => {
    const found = inbox.getThread(thread.id)
    if (!found) throw new Error("thread vanished")
    return found
  }
  const settled = (count: number) => waitFor(() => read().outbound.filter((outbound) => outbound.status !== "pending").length === count)
  return { inbox, log, tool, outbox, thread, read, settled }
}

function sendOk(result: Awaited<ReturnType<ReturnType<typeof createInboxOutbox>["send"]>>): string {
  if (!result.ok) throw new Error(result.error)
  return result.outboundId
}

test("a direct send calls the source tool with the mapped arguments and marks the thread replied only after it succeeds", async () => {
  const { tool, outbox, thread, read, settled } = await setup()
  let release: (value: JsonValue) => void = () => {}
  tool.behavior = () => new Promise<JsonValue>((resolve) => { release = resolve })

  const outboundId = sendOk(await outbox.send(thread.id, "  on my way  ", "you"))

  expect(tool.calls).toEqual([{ sourceId: "zalo", name: "zalo_send_message", args: { threadId: "t-9", threadType: 1, text: "on my way" } }])
  expect(read().state).toBe("new")
  expect(read().outbound).toMatchObject([{ id: outboundId, text: "on my way", by: "you", status: "pending" }])

  release({ msgId: "m-77" })
  await settled(1)

  expect(read()).toMatchObject({ state: "replied", replyCount: 1, outbound: [{ id: outboundId, status: "sent", resultId: "m-77" }] })
  expect(tool.keys).toEqual(["m-77"])
})

test("a call the tool rejects stays failed and a retry sends the same text as a new message that succeeds", async () => {
  const { tool, outbox, thread, read, settled } = await setup()
  tool.behavior = async () => { throw new McpToolRejectedError("recipient is blocked") }
  const first = sendOk(await outbox.send(thread.id, "hello", "you"))
  await settled(1)
  expect(read()).toMatchObject({ state: "new", replyCount: 0, outbound: [{ id: first, status: "failed", error: "recipient is blocked" }] })

  tool.behavior = async () => ({ msgId: "m-2" })
  const second = sendOk(await outbox.retry(thread.id, first, false))
  await settled(2)

  expect(second).not.toBe(first)
  expect(read().outbound.map((outbound) => [outbound.status, outbound.text])).toEqual([["failed", "hello"], ["sent", "hello"]])
  expect(read().state).toBe("replied")
})

test("a message that was already retried cannot be retried again, so it cannot be delivered twice", async () => {
  const { tool, outbox, thread, read, settled } = await setup()
  tool.behavior = async () => { throw new McpToolRejectedError("recipient is blocked") }
  const first = sendOk(await outbox.send(thread.id, "hello", "you"))
  await settled(1)

  tool.behavior = async () => ({ msgId: "m-2" })
  const second = sendOk(await outbox.retry(thread.id, first, false))
  await settled(2)
  const again = await outbox.retry(thread.id, first, true)

  expect(again.ok).toBe(false)
  expect(tool.calls).toHaveLength(2)
  expect(read().outbound.map((outbound) => [outbound.id, outbound.retryOf])).toEqual([[first, undefined], [second, first]])
})

test("a transport error is not confirmed, so a retry needs confirmDuplicate", async () => {
  const { tool, outbox, thread, read, settled } = await setup()
  tool.behavior = async () => { throw new Error("socket hang up") }
  const first = sendOk(await outbox.send(thread.id, "hello", "you"))
  await settled(1)
  expect(read().outbound[0]).toMatchObject({ status: "unknown", error: "socket hang up" })
  expect(read().state).toBe("new")

  const refused = await outbox.retry(thread.id, first, false)
  expect(refused.ok).toBe(false)
  expect(tool.calls).toHaveLength(1)

  tool.behavior = async () => ({ msgId: "m-3" })
  sendOk(await outbox.retry(thread.id, first, true))
  await settled(2)
  expect(tool.calls).toHaveLength(2)
  expect(read().outbound.map((outbound) => outbound.status)).toEqual(["unknown", "sent"])
})

test("a source that is gone or disabled fails the message without it being treated as maybe delivered", async () => {
  const { tool, outbox, thread, read, settled } = await setup()
  tool.behavior = async () => { throw new McpSourceUnavailableError("MCP server is disabled") }
  sendOk(await outbox.send(thread.id, "hello", "you"))
  await settled(1)
  expect(read().outbound[0]).toMatchObject({ status: "failed", error: "MCP server is disabled" })
})

test("a message whose arguments cannot be resolved fails without calling the tool", async () => {
  const { inbox } = await createInboxHarness({ now: () => 500 })
  const tool = createFakeTool()
  const outbox = createInboxOutbox({
    registry: inbox,
    resolveSource: () => ({ id: "zalo", reply: REPLY }),
    callTool: tool.callTool,
    rememberKey: tool.rememberKey,
  })
  const thread = await inbox.ingestInbound({ ...inbound(), payload: { text: "no thread id" } }, { threadKey: "k", sender: "An", sourceName: "Zalo", deliveryId: "d1" })

  sendOk(await outbox.send(thread.id, "hello", "you"))

  expect(tool.calls).toEqual([])
  expect(inbox.getThread(thread.id)?.outbound[0]).toMatchObject({ status: "failed" })
  expect(inbox.getThread(thread.id)?.outbound[0]?.error).toContain("message.threadId")
})

test("a Notify-mode thread, which has no handler chat, can be replied to", async () => {
  const { store, agent, bus, inbox, chat } = await createWebhookHarness()
  const result = await deliverInbound(store, agent, bus, inbox, {
    source: { kind: "mcp", sourceId: "zalo", sourceName: "Zalo", serverId: "srv", serverName: "zalo-mcp" },
    sourceName: "Zalo",
    handler: { mode: "notify", chatId: chat.id, template: "t", replyHint: "", pushEnabled: true },
    deliveryId: "d1",
    body: MESSAGE,
    threadKey: "t-9",
    sender: "An",
    at: 10,
  })
  if (!result.ok) throw new Error(result.detail)
  expect(inbox.getThread(result.threadId)?.chatId).toBeUndefined()
  const tool = createFakeTool()
  const outbox = createInboxOutbox({
    registry: inbox,
    resolveSource: () => ({ id: "zalo", reply: REPLY }),
    callTool: tool.callTool,
    rememberKey: tool.rememberKey,
  })

  sendOk(await outbox.send(result.threadId, "hello", "you"))
  await waitFor(() => inbox.getThread(result.threadId)?.state === "replied")

  expect(tool.calls).toHaveLength(1)
})

test("a restart settles a still-pending message as unknown and never sends it again", async () => {
  const { inbox, log, tool, outbox, thread } = await setup()
  tool.behavior = () => new Promise<JsonValue>(() => {})
  const outboundId = sendOk(await outbox.send(thread.id, "hello", "you"))
  expect(inbox.getThread(thread.id)?.outbound[0]?.status).toBe("pending")

  const restarted = await createInboxHarness({ log, now: () => 900 })
  const after = restarted.inbox.getThread(thread.id)

  expect(after?.outbound).toMatchObject([{ id: outboundId, status: "unknown", error: "Kanna restarted before the send finished" }])
  expect(after?.state).toBe("new")
  expect(tool.calls).toHaveLength(1)
  const again = new InboxRegistry(log, restarted.bus, () => 1000)
  await again.initialize()
  expect(log.events.filter((event) => event.kind === "inbox_thread_outbound_settled")).toHaveLength(1)
})

test("a thread whose source has no reply target is not sendable", async () => {
  const { inbox } = await createInboxHarness()
  const tool = createFakeTool()
  const outbox = createInboxOutbox({ registry: inbox, resolveSource: () => null, callTool: tool.callTool, rememberKey: tool.rememberKey })
  const thread = await inbox.ingestInbound(inbound(), { threadKey: "t-9", sender: "An", sourceName: "Zalo", deliveryId: "d1" })
  expect(outbox.hasReplyTarget(thread.id)).toBe(false)
  expect((await outbox.send(thread.id, "hello", "you")).ok).toBe(false)
  expect(tool.calls).toEqual([])
})
