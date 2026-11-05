import { expect, test } from "vite-plus/test"
import type { InboundHandler } from "../../shared/inbound/handler"
import { MCP_SOURCE_AUTONOMY_DEFAULTS, type McpSourceAutonomy } from "../../shared/inbox/autonomy"
import type { JsonValue } from "../../shared/json"
import type { McpSourceReply } from "../../shared/mcp-sources/types"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import type { PushPayload } from "../../shared/types"
import { createFakeAutopilotClock } from "../test-helpers/autopilot-clock"
import { createInboxHarness } from "../test-helpers/inbox-harness"
import type { PushEvent, PushEventStore } from "../push/events"
import { PushManager, type WebPushSender } from "../push/push-manager"
import { createInboxAutopilot } from "./inbox-autopilot"
import { wireInboxPush } from "./inbox-boot"
import { createInboxOutbox } from "./inbox-outbox"

const REPLY: McpSourceReply = { tool: "send", args: { text: "{{reply.text}}" }, resultIdPath: "msgId" }
const START = 1_000_000
const PROPOSAL_TEXT = "It is due on Friday."

class MemoryPushStore implements PushEventStore {
  events: PushEvent[] = []
  async appendPushEvent(event: PushEvent) { this.events.push(event) }
  async loadPushEvents() { return [...this.events] }
}

function inbound(): BusEnvelope {
  return {
    v: 1,
    id: "env-1",
    subject: "kanna.mcp.zalo.item",
    ts: START,
    source: { kind: "mcp", sourceId: "zalo", sourceName: "Zalo", serverId: "srv", serverName: "zalo-mcp" },
    direction: "inbound",
    idempotencyKey: "mcp:zalo:d1",
    payload: { threadId: "t-9", text: "when is the invoice due?" },
  }
}

interface Options {
  pushPreview?: boolean
  pushEnabled?: boolean
  autonomy?: Partial<McpSourceAutonomy>
}

async function setup(options: Options = {}) {
  const clock = createFakeAutopilotClock(START)
  const { inbox } = await createInboxHarness({ now: clock.now })
  const pushed: PushPayload[] = []
  const sender: WebPushSender = { send: async (_sub, body) => { pushed.push(JSON.parse(body)) } }
  const store = new MemoryPushStore()
  const manager = new PushManager({ store, sender, vapid: { publicKey: "pub", privateKey: "prv", subject: "mailto:test@kanna" }, now: clock.now })
  store.events.push({
    kind: "subscription_added",
    ts: 1,
    id: "d1",
    record: { id: "d1", endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" }, label: "Test", userAgent: "Test", createdAt: 1, lastSeenAt: 1 },
  })
  await manager.initialize()
  const autonomy: McpSourceAutonomy = { ...MCP_SOURCE_AUTONOMY_DEFAULTS, level: "approve", ...options.autonomy }
  const handler: InboundHandler = {
    mode: "spawn",
    template: "",
    replyHint: "",
    pushEnabled: options.pushEnabled ?? true,
    ...(options.pushPreview === true ? { pushPreview: true } : {}),
  }
  const outbox = createInboxOutbox({
    registry: inbox,
    resolveSource: () => ({ id: "zalo", reply: REPLY }),
    callTool: async (): Promise<JsonValue> => ({ msgId: "m-1" }),
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
  wireInboxPush(inbox, manager, () => handler, () => ({ id: "zalo", hasReply: true, autonomy }))
  const thread = await inbox.ingestInbound(inbound(), { threadKey: "t-9", sender: "An", sourceName: "Zalo", deliveryId: "d1", text: "when is the invoice due?" })
  await inbox.bindChat(thread.id, "chat-1")
  const report = (propose: boolean) =>
    inbox.report(thread.id, "chat-1", "needs_you", "Asked about the invoice", undefined, propose ? { text: PROPOSAL_TEXT, confidence: 0.95, reason: "Friday" } : undefined)
  return { inbox, thread, pushed, report }
}

test("a needs_you push carries the message preview only when the source opted in", async () => {
  const off = await setup()
  await off.report(false)
  const on = await setup({ pushPreview: true })
  await on.report(false)

  expect(off.pushed).toHaveLength(1)
  expect(off.pushed[0]?.body).toBeUndefined()
  expect(on.pushed).toHaveLength(1)
  expect(on.pushed[0]?.body).toContain("when is the invoice due?")
})

test("an open approval card pushes with a Send action only when the source opted in", async () => {
  const plain = await setup()
  await plain.report(true)
  const sendable = await setup({ autonomy: { sendFromNotification: true } })
  await sendable.report(true)

  const proposalPush = (pushed: PushPayload[]) => pushed.find((payload) => payload.kind === "inbox_proposal")
  expect(proposalPush(plain.pushed)).toMatchObject({ proposalId: "proposal-1", body: "Agent wants to reply" })
  expect(proposalPush(plain.pushed)?.actions).toBeUndefined()
  expect(proposalPush(sendable.pushed)).toMatchObject({
    threadId: sendable.thread.id,
    proposalId: "proposal-1",
    actions: [{ action: "send", title: "Send" }],
  })
})

test("the proposal text reaches the push only with the preview opt-in, and nothing like a token is in the payload", async () => {
  const hidden = await setup({ autonomy: { sendFromNotification: true } })
  await hidden.report(true)
  const shown = await setup({ pushPreview: true, autonomy: { sendFromNotification: true } })
  await shown.report(true)

  const proposal = (pushed: PushPayload[]) => pushed.find((payload) => payload.kind === "inbox_proposal")
  expect(JSON.stringify(proposal(hidden.pushed))).not.toContain(PROPOSAL_TEXT)
  expect(proposal(shown.pushed)?.body).toBe(PROPOSAL_TEXT)
  expect(Object.keys(proposal(shown.pushed) ?? {}).sort()).toEqual(
    ["actions", "body", "chatId", "chatTitle", "chatUrl", "kind", "projectLocalPath", "projectTitle", "proposalId", "threadId", "ts", "v"],
  )
})

test("a paused thread, a disabled source push and a scheduled auto-send raise no proposal push", async () => {
  const paused = await setup()
  await paused.inbox.pauseAgent(paused.thread.id, START + 60_000)
  await paused.report(true)
  const muted = await setup({ pushEnabled: false })
  await muted.report(true)
  const auto = await setup({ autonomy: { level: "auto", allowlist: ["t-9"] } })
  await auto.report(true)

  const proposalPushes = (pushed: PushPayload[]) => pushed.filter((payload) => payload.kind === "inbox_proposal")
  expect(proposalPushes(paused.pushed)).toEqual([])
  expect(proposalPushes(muted.pushed)).toEqual([])
  expect(proposalPushes(auto.pushed)).toEqual([])
})
