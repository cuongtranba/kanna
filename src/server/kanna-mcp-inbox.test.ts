import { expect, test } from "vite-plus/test"
import { z } from "zod"
import type { BusEnvelope } from "../shared/service-bus/envelope"
import { buildInboxToolList } from "./kanna-mcp-inbox"
import { createInboxHarness } from "./test-helpers/inbox-harness"
import { invokeTool, sdkToolFactory, toolText } from "./test-helpers/sdk-tool"

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
  expect(buildInboxToolList(inbox, "chat-1", 1, sdkToolFactory)).toEqual([])
  expect(buildInboxToolList(undefined, "chat-1", 0, sdkToolFactory)).toEqual([])
  expect(buildInboxToolList(inbox, null, 0, sdkToolFactory)).toEqual([])
})

test("inbox_report reaches the registry with the session's chat id", async () => {
  const { inbox, threadId } = await seededThread()
  const [report] = buildInboxToolList(inbox, "chat-1", 0, sdkToolFactory)
  expect(report.name).toBe("inbox_report")
  const result = await invokeTool(report, { thread_id: threadId, verdict: "needs_you", summary: "Pay it", draft_reply: "On it" })
  expect(toolText(result)).toBe(`Reported needs_you on thread ${threadId}`)
  expect(inbox.getThread(threadId)).toMatchObject({
    state: "needs_you",
    report: { chatId: "chat-1", summary: "Pay it", draftReply: "On it" },
  })
})

test("a report from another chat is returned as a tool error", async () => {
  const { inbox, threadId } = await seededThread()
  const [report] = buildInboxToolList(inbox, "chat-2", 0, sdkToolFactory)
  const result = await invokeTool(report, { thread_id: threadId, verdict: "fyi", summary: "x" })
  expect(result.isError).toBe(true)
  expect(inbox.getThread(threadId)?.state).toBe("new")
})

test("an unknown verdict is rejected by the tool schema before reaching the registry", async () => {
  const { inbox, threadId } = await seededThread()
  const [report] = buildInboxToolList(inbox, "chat-1", 0, sdkToolFactory)
  const verdict = z.object(report.inputSchema).safeParse({ thread_id: threadId, verdict: "maybe", summary: "x" })
  expect(verdict.success).toBe(false)
  expect(inbox.getThread(threadId)?.state).toBe("new")
})
