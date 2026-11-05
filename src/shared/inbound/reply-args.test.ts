import { expect, test } from "vite-plus/test"
import type { McpSourceReply } from "../mcp-sources/types"
import { resolveReplyArgs } from "./reply-args"

const ZALO_REPLY: McpSourceReply = {
  tool: "zalo_send_message",
  args: {
    threadId: "{{message.threadId}}",
    threadType: { from: "message.threadType", map: { dm: 0, group: 1 } },
    text: "{{reply.text}}",
  },
  resultIdPath: "",
}

const message = { threadId: "t-9", threadType: "group", text: "inbound words" }

test("an exact placeholder keeps its JSON type and a value map turns the thread type into its number", () => {
  const result = resolveReplyArgs({ ...ZALO_REPLY, args: { ...ZALO_REPLY.args, retries: "{{message.retries}}" } }, { ...message, retries: 3 }, "hi")
  expect(result).toEqual({ ok: true, args: { threadId: "t-9", threadType: 1, text: "hi", retries: 3 } })
})

test("a placeholder mixed with other text is interpolated as a string", () => {
  const result = resolveReplyArgs({ tool: "t", args: { text: "To {{message.threadId}}: {{reply.text}}" }, resultIdPath: "" }, message, "ok")
  expect(result).toEqual({ ok: true, args: { text: "To t-9: ok" } })
})

test("{{reply.text}} is the reply even when the inbound payload has its own text field", () => {
  const result = resolveReplyArgs(ZALO_REPLY, message, "my answer")
  expect(result).toMatchObject({ ok: true, args: { text: "my answer" } })
})

test("a value map without a match uses the default, and is an error when there is none", () => {
  const withDefault: McpSourceReply = { tool: "t", args: { kind: { from: "message.threadType", map: { dm: 0 }, default: 9 } }, resultIdPath: "" }
  expect(resolveReplyArgs(withDefault, message, "x")).toEqual({ ok: true, args: { kind: 9 } })
  const withoutDefault: McpSourceReply = { tool: "t", args: { kind: { from: "message.threadType", map: { dm: 0 } } }, resultIdPath: "" }
  const failed = resolveReplyArgs(withoutDefault, message, "x")
  expect(failed.ok).toBe(false)
})

test("an unresolved or empty path names the argument and builds no arguments", () => {
  const missing = resolveReplyArgs(ZALO_REPLY, { threadType: "dm" }, "hi")
  expect(missing).toEqual({ ok: false, error: 'Reply argument "threadId" needs "message.threadId", which is empty in this message' })
  const empty = resolveReplyArgs({ tool: "t", args: { text: "re {{message.subject}}" }, resultIdPath: "" }, { subject: "" }, "hi")
  expect(empty.ok).toBe(false)
})
