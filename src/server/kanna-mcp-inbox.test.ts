import { expect, test } from "vite-plus/test"
import type { ZodTypeAny } from "zod"
import type { JsonObject } from "../shared/json"
import type { BusEnvelope } from "../shared/service-bus/envelope"
import { buildInboxToolList } from "./kanna-mcp-inbox"
import type { KannaToolFactory, ToolResult } from "./kanna-mcp-tool"
import { createInboxHarness } from "./test-helpers/inbox-harness"

interface CapturedTool {
  readonly name: string
  readonly schema: Record<string, ZodTypeAny>
  run(input: JsonObject): Promise<ToolResult>
}

const capture: KannaToolFactory<CapturedTool> = (name, _description, schema, handler) => ({ name, schema, run: handler })

function textOf(result: ToolResult): string {
  return result.content.map((block) => block.text).join("\n")
}

async function seededThread() {
  const harness = await createInboxHarness()
  const envelope: BusEnvelope = {
    v: 1,
    id: "e1",
    subject: "kanna.mcp.mail.message",
    ts: 1,
    source: { kind: "mcp", sourceId: "mail", sourceName: "Mail", serverId: "s", serverName: "mail" },
    direction: "inbound",
    idempotencyKey: "k",
    payload: { text: "hi" },
  }
  const thread = await harness.inbox.ingestInbound(envelope, { threadKey: "t", sender: "ada", sourceName: "Mail", deliveryId: "d1" })
  await harness.inbox.bindChat(thread.id, "chat-1")
  return { ...harness, threadId: thread.id }
}

test("a subagent session gets no inbox tools", async () => {
  const { inbox } = await seededThread()
  expect(buildInboxToolList(inbox, "chat-1", 1, capture)).toEqual([])
  expect(buildInboxToolList(undefined, "chat-1", 0, capture)).toEqual([])
  expect(buildInboxToolList(inbox, null, 0, capture)).toEqual([])
})

test("inbox_report reaches the registry with the session's chat id", async () => {
  const { inbox, threadId } = await seededThread()
  const [report] = buildInboxToolList(inbox, "chat-1", 0, capture)
  expect(report.name).toBe("inbox_report")
  const result = await report.run({ thread_id: threadId, verdict: "needs_you", summary: "Pay it", draft_reply: "On it" })
  expect(textOf(result)).toBe(`Reported needs_you on thread ${threadId}`)
  expect(inbox.getThread(threadId)).toMatchObject({
    state: "needs_you",
    report: { chatId: "chat-1", summary: "Pay it", draftReply: "On it" },
  })
})

test("a report from another chat is returned as a tool error", async () => {
  const { inbox, threadId } = await seededThread()
  const [report] = buildInboxToolList(inbox, "chat-2", 0, capture)
  const result = await report.run({ thread_id: threadId, verdict: "fyi", summary: "x" })
  expect(result.isError).toBe(true)
  expect(inbox.getThread(threadId)?.state).toBe("new")
})

test("an unknown verdict is rejected before reaching the registry", async () => {
  const { inbox, threadId } = await seededThread()
  const [report] = buildInboxToolList(inbox, "chat-1", 0, capture)
  const result = await report.run({ thread_id: threadId, verdict: "maybe", summary: "x" })
  expect(result.isError).toBe(true)
})
