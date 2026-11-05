import { expect, test } from "vite-plus/test"
import { INBOX_TAKEOVER_PAUSE_MS, MCP_SOURCE_AUTONOMY_DEFAULTS, type McpSourceAutonomy } from "../../shared/inbox/autonomy"
import type { InboxThread } from "../../shared/inbox/types"
import type { JsonObject, JsonValue } from "../../shared/json"
import type { McpSourceReply } from "../../shared/mcp-sources/types"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { createFakeAutopilotClock } from "../test-helpers/autopilot-clock"
import { createInboxHarness, createMemoryInboxLog } from "../test-helpers/inbox-harness"
import { waitFor } from "../test-helpers/wait-for"
import { createInboxAutopilot } from "./inbox-autopilot"
import { createInboxOutbox } from "./inbox-outbox"
import { InboxRegistry } from "./inbox-registry"

const REPLY: McpSourceReply = { tool: "zalo_send_message", args: { threadId: "{{message.threadId}}", text: "{{reply.text}}" }, resultIdPath: "msgId" }
const AUTO: McpSourceAutonomy = { ...MCP_SOURCE_AUTONOMY_DEFAULTS, level: "auto", allowlist: ["t-9"], sendDelaySeconds: 30 }
const START = 1_000_000

function inbound(deliveryId: string): BusEnvelope {
  return {
    v: 1,
    id: `env-${deliveryId}`,
    subject: "kanna.mcp.zalo.item",
    ts: START,
    source: { kind: "mcp", sourceId: "zalo", sourceName: "Zalo", serverId: "srv", serverName: "zalo-mcp" },
    direction: "inbound",
    idempotencyKey: `mcp:zalo:${deliveryId}`,
    payload: { threadId: "t-9", text: "when is the invoice due?" },
  }
}

function meta(deliveryId: string) {
  return { threadKey: "t-9", sender: "An", sourceName: "Zalo", deliveryId }
}

async function setup(autonomy: McpSourceAutonomy = AUTO) {
  const clock = createFakeAutopilotClock(START)
  const log = createMemoryInboxLog()
  const { inbox } = await createInboxHarness({ now: clock.now, log })
  const sent: JsonObject[] = []
  const outbox = createInboxOutbox({
    registry: inbox,
    resolveSource: () => ({ id: "zalo", reply: REPLY }),
    callTool: async (_sourceId, _name, args): Promise<JsonValue> => { sent.push(args); return { msgId: `m-${String(sent.length)}` } },
    rememberKey: () => {},
  })
  const autopilot = createInboxAutopilot({
    registry: inbox,
    outbox,
    resolveSource: () => ({ id: "zalo", hasReply: true, autonomy }),
    clock,
    ids: () => "proposal-1",
  })
  inbox.onProposeSend((threadId, proposal) => autopilot.propose(threadId, proposal))
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  await inbox.bindChat(thread.id, "chat-1")
  const read = (): InboxThread => {
    const found = inbox.getThread(thread.id)
    if (!found) throw new Error("thread vanished")
    return found
  }
  const propose = (text = "It is due on Friday.", confidence = 0.95) =>
    inbox.report(thread.id, "chat-1", "needs_you", "Asked about the invoice", undefined, { text, confidence, reason: "The invoice says Friday" })
  return { clock, inbox, log, sent, autopilot, thread, read, propose }
}

test("an auto proposal waits out its delay, then sends as the agent with its provenance", async () => {
  const { clock, sent, read, propose } = await setup()

  expect(await propose()).toEqual({ ok: true })
  expect(read().proposal).toMatchObject({ id: "proposal-1", status: "scheduled", scheduledFor: START + 30_000 })
  expect(sent).toEqual([])

  clock.advance(30_000)
  await waitFor(() => read().proposal === undefined && read().outbound[0]?.status === "sent")

  expect(sent).toEqual([{ threadId: "t-9", text: "It is due on Friday." }])
  expect(read().outbound[0]).toMatchObject({
    by: "agent",
    text: "It is due on Friday.",
    proposal: { id: "proposal-1", confidence: 0.95, reason: "The invoice says Friday" },
  })
})

test("Undo before the delay ends cancels the send", async () => {
  const { clock, sent, read, autopilot, thread, propose } = await setup()
  await propose()

  expect(await autopilot.cancel(thread.id, "proposal-1")).toEqual({ ok: true })
  clock.advance(60_000)

  expect(sent).toEqual([])
  expect(read().proposal).toBeUndefined()
  expect(read().outbound).toEqual([])
  expect(clock.pending()).toBe(0)
})

test("a new inbound message before the delay ends expires the proposal and nothing is sent", async () => {
  const { clock, inbox, sent, read, propose } = await setup()
  await propose()

  await inbox.ingestInbound(inbound("d2"), meta("d2"))
  clock.advance(30_000)
  await inbox.flush()

  expect(read().proposal).toBeUndefined()
  expect(sent).toEqual([])
  expect(read().outbound).toEqual([])
})

test("a thread paused before the delay ends is not sent to", async () => {
  const { clock, inbox, sent, read, thread, propose } = await setup()
  await propose()

  await inbox.pauseAgent(thread.id, clock.now() + 60_000)
  clock.advance(30_000)
  await waitFor(() => read().proposal === undefined)

  expect(sent).toEqual([])
})

test("after a restart a scheduled proposal is an open approval card and is never sent", async () => {
  const { clock, log, sent, propose } = await setup()
  await propose()

  const restarted = new InboxRegistry(log, (await createInboxHarness()).bus, clock.now)
  await restarted.initialize()
  clock.advance(10 * 60_000)
  await restarted.flush()

  const [thread] = restarted.snapshot().threads
  expect(thread.proposal).toMatchObject({ id: "proposal-1", status: "open", blockedBy: "Kanna restarted before the auto-send" })
  expect(thread.proposal?.scheduledFor).toBeUndefined()
  expect(sent).toEqual([])
})

test("Undo racing the fire produces exactly one outcome: the send wins and Undo is refused", async () => {
  const { clock, sent, read, autopilot, thread, propose } = await setup()
  await propose()

  clock.advance(30_000)
  const undo = await autopilot.cancel(thread.id, "proposal-1")
  await waitFor(() => read().outbound[0]?.status === "sent")

  expect(undo.ok).toBe(false)
  expect(sent).toHaveLength(1)
  expect(read().proposal).toBeUndefined()
})

test("a low-confidence proposal in Auto becomes an approval card that names the rule", async () => {
  const { clock, sent, read, propose } = await setup()

  await propose("It is due on Friday.", 0.3)

  expect(read().proposal).toMatchObject({ status: "open", blockedBy: expect.stringMatching(/Confidence 30%/) })
  clock.advance(120_000)
  expect(sent).toEqual([])
})

test("approving sends the edited text as approved and pauses the agent", async () => {
  const { clock, sent, read, autopilot, thread, propose } = await setup({ ...AUTO, level: "approve" })
  await propose()
  expect(read().proposal).toMatchObject({ status: "open" })
  expect(read().proposal?.blockedBy).toBeUndefined()

  const result = await autopilot.approve(thread.id, "proposal-1", "It is due next Friday.")

  expect(result.ok).toBe(true)
  await waitFor(() => read().outbound[0]?.status === "sent")
  expect(sent).toEqual([{ threadId: "t-9", text: "It is due next Friday." }])
  expect(read().outbound[0]).toMatchObject({ by: "approved", proposal: { id: "proposal-1" } })
  expect(read().proposal).toBeUndefined()
  expect(read().agentPausedUntil).toBe(clock.now() + INBOX_TAKEOVER_PAUSE_MS)
})

test("rejecting resolves the proposal without sending", async () => {
  const { sent, read, autopilot, thread, propose } = await setup({ ...AUTO, level: "approve" })
  await propose()

  expect(await autopilot.reject(thread.id, "proposal-1")).toEqual({ ok: true })

  expect(read().proposal).toBeUndefined()
  expect(sent).toEqual([])
  expect((await autopilot.reject(thread.id, "proposal-1")).ok).toBe(false)
})

test("a human reply takes over: it cancels the open proposal and pauses the agent", async () => {
  const { clock, read, autopilot, thread, propose } = await setup({ ...AUTO, level: "approve" })
  await propose()

  await autopilot.takeOver(thread.id)

  expect(read().proposal).toBeUndefined()
  expect(read().agentPausedUntil).toBe(clock.now() + INBOX_TAKEOVER_PAUSE_MS)
})

test("a paused thread only gets a draft and a suggest source only gets a draft", async () => {
  const paused = await setup({ ...AUTO, level: "approve" })
  await paused.inbox.pauseAgent(paused.thread.id, paused.clock.now() + 60_000)
  await paused.propose()
  expect(paused.read().proposal).toBeUndefined()
  expect(paused.read().drafts.map((draft) => draft.origin)).toEqual(["proposal"])

  const suggest = await setup({ ...AUTO, level: "suggest" })
  await suggest.propose()
  expect(suggest.read().proposal).toBeUndefined()
  expect(suggest.read().drafts.map((draft) => draft.text)).toEqual(["It is due on Friday."])
})

test("a thread-level override beats the source level", async () => {
  const { inbox, read, thread, propose } = await setup({ ...AUTO, level: "suggest" })
  await inbox.setThreadAutonomy(thread.id, "approve")

  await propose()

  expect(read().proposal).toMatchObject({ status: "open" })
})

test("a Codex handler never gets Auto, only an approval card", async () => {
  const clock = createFakeAutopilotClock(START)
  const { inbox } = await createInboxHarness({ now: clock.now })
  const sent: JsonObject[] = []
  const outbox = createInboxOutbox({
    registry: inbox,
    resolveSource: () => ({ id: "zalo", reply: REPLY }),
    callTool: async (_sourceId, _name, args): Promise<JsonValue> => { sent.push(args); return {} },
    rememberKey: () => {},
  })
  const autopilot = createInboxAutopilot({
    registry: inbox,
    outbox,
    resolveSource: () => ({ id: "zalo", hasReply: true, autonomy: AUTO, provider: "codex" }),
    clock,
  })
  inbox.onProposeSend((threadId, proposal) => autopilot.propose(threadId, proposal))
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  await inbox.bindChat(thread.id, "chat-1")

  await inbox.report(thread.id, "chat-1", "needs_you", "s", undefined, { text: "Friday", confidence: 1, reason: "r" })

  expect(inbox.getThread(thread.id)?.proposal).toMatchObject({ status: "open", blockedBy: expect.stringMatching(/not available/) })
  clock.advance(120_000)
  expect(sent).toEqual([])
})
