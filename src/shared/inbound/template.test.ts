import { expect, test } from "bun:test"
import { INBOX_REPORT_TOOL_NAME } from "../tools"
import { renderHandlerInstruction, resolvePath } from "./template"

test("resolvePath walks objects and arrays and returns undefined for a miss", () => {
  const body = { a: { b: [{ c: 1 }] } }
  expect(resolvePath(body, "a.b.0.c")).toBe(1)
  expect(resolvePath(body, "a.x")).toBeUndefined()
})

test("the handler instruction names the thread and the report tool and forbids replying itself", () => {
  const text = renderHandlerInstruction({ threadId: "t-9", sourceName: "Mail", replyHint: "Use send_mail." })
  expect(text).toContain("thread_id t-9")
  expect(text).toContain(INBOX_REPORT_TOOL_NAME)
  expect(text).toContain("NEVER send anything to the sender")
  expect(text).toContain("Use send_mail.")
})

test("the task instruction tells the agent to carry out the hook's instruction and report once, without the triage ban", () => {
  const text = renderHandlerInstruction({ threadId: "t-9", sourceName: "Mail", replyHint: "Use send_mail.", handling: "task" })
  expect(text).toContain("You are running a task triggered by an inbound message from Mail")
  expect(text).toContain(`call ${INBOX_REPORT_TOOL_NAME} once with thread_id t-9`)
  expect(text).toContain("Use send_mail.")
  expect(text).not.toContain("NEVER send anything to the sender")
})
