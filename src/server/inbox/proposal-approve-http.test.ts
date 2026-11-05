import { afterEach, expect, test } from "vite-plus/test"
import { MCP_SOURCE_AUTONOMY_DEFAULTS } from "../../shared/inbox/autonomy"
import { HTTP_ROUTES } from "../../shared/http-routes"
import type { InboxThread } from "../../shared/inbox/types"
import type { JsonObject, JsonValue } from "../../shared/json"
import type { McpSourceReply } from "../../shared/mcp-sources/types"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { createFakeAutopilotClock } from "../test-helpers/autopilot-clock"
import { createInboxHarness } from "../test-helpers/inbox-harness"
import { waitFor } from "../test-helpers/wait-for"
import { createInboxAutopilot } from "./inbox-autopilot"
import { createInboxOutbox } from "./inbox-outbox"
import { handleProposalApproveRequest } from "./proposal-approve-http"

const REPLY: McpSourceReply = { tool: "send", args: { threadId: "{{message.threadId}}", text: "{{reply.text}}" }, resultIdPath: "msgId" }
const START = 1_000_000
const PATH = HTTP_ROUTES.inboxProposalApprove.path

const stops: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()))
})

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

async function setup() {
  const clock = createFakeAutopilotClock(START)
  const { inbox } = await createInboxHarness({ now: clock.now })
  const sent: JsonObject[] = []
  const outbox = createInboxOutbox({
    registry: inbox,
    resolveSource: () => ({ id: "zalo", reply: REPLY }),
    callTool: async (_sourceId, _name, args): Promise<JsonValue> => { sent.push(args); return { msgId: "m-1" } },
    rememberKey: () => {},
  })
  const autopilot = createInboxAutopilot({
    registry: inbox,
    outbox,
    resolveSource: () => ({ id: "zalo", hasReply: true, autonomy: { ...MCP_SOURCE_AUTONOMY_DEFAULTS, level: "approve" } }),
    clock,
    ids: () => "proposal-1",
  })
  inbox.onProposeSend((threadId, proposal) => autopilot.propose(threadId, proposal))
  const thread = await inbox.ingestInbound(inbound(), { threadKey: "t-9", sender: "An", sourceName: "Zalo", deliveryId: "d1" })
  await inbox.bindChat(thread.id, "chat-1")
  await inbox.report(thread.id, "chat-1", "needs_you", "Asked about the invoice", undefined, {
    text: "It is due on Friday.",
    confidence: 0.95,
    reason: "The invoice says Friday",
  })
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => (await handleProposalApproveRequest(req, new URL(req.url), autopilot.approve, null)) ?? new Response("nope", { status: 404 }),
  })
  stops.push(async () => { await server.stop(true) })
  const read = (): InboxThread => {
    const found = inbox.getThread(thread.id)
    if (!found) throw new Error("thread vanished")
    return found
  }
  const post = (body: JsonValue, headers: Record<string, string> = { origin: `http://127.0.0.1:${String(server.port)}` }) =>
    fetch(`http://127.0.0.1:${String(server.port)}${PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  return { sent, thread, read, post }
}

test("approving an open proposal sends it as approved and answers with the outbound id", async () => {
  const { sent, thread, read, post } = await setup()

  const response = await post({ threadId: thread.id, proposalId: "proposal-1" })

  expect(response.status).toBe(200)
  const body: JsonValue = await response.json()
  expect(body).toEqual({ outboundId: expect.any(String) })
  await waitFor(() => read().outbound[0]?.status === "sent")
  expect(sent).toEqual([{ threadId: "t-9", text: "It is due on Friday." }])
  expect(read().outbound[0]).toMatchObject({ by: "approved", proposal: { id: "proposal-1" } })
})

test("a proposal that is no longer open answers 409 and sends nothing more", async () => {
  const { sent, thread, post } = await setup()
  await post({ threadId: thread.id, proposalId: "proposal-1" })

  const again = await post({ threadId: thread.id, proposalId: "proposal-1" })

  expect(again.status).toBe(409)
  expect(sent).toHaveLength(1)
})

test("a cross-origin or origin-less request answers 403 and sends nothing", async () => {
  const { sent, thread, read, post } = await setup()

  const crossOrigin = await post({ threadId: thread.id, proposalId: "proposal-1" }, { origin: "https://evil.example" })
  const noOrigin = await post({ threadId: thread.id, proposalId: "proposal-1" }, {})

  expect(crossOrigin.status).toBe(403)
  expect(noOrigin.status).toBe(403)
  expect(sent).toEqual([])
  expect(read().proposal).toMatchObject({ status: "open" })
})

test("a body without thread and proposal ids answers 400", async () => {
  const { post } = await setup()

  expect((await post({ threadId: "x" })).status).toBe(400)
})
