import { expect, test } from "vite-plus/test"
import { inboundScheduleId, inboxHandlerTurnKind, inboxInstructScheduleId, inboxReplyScheduleId } from "./handler-turn"

test("every schedule id the inbox builds maps back to its turn kind", () => {
  const webhook = inboundScheduleId({ kind: "webhook", hookId: "h1", hookName: "CI" }, "d1")
  const mcp = inboundScheduleId({ kind: "mcp", sourceId: "s1", sourceName: "Zalo", serverId: "srv", serverName: "zalo-mcp" }, "d1")
  expect(inboxHandlerTurnKind(webhook)).toBe("triage")
  expect(inboxHandlerTurnKind(mcp)).toBe("triage")
  expect(inboxHandlerTurnKind(inboxInstructScheduleId("t1", 10))).toBe("ask")
  expect(inboxHandlerTurnKind(inboxReplyScheduleId("t1", 2))).toBe("agent-reply")
})

test("a turn that is not an inbox handler turn has no kind", () => {
  expect(inboxHandlerTurnKind(undefined)).toBeNull()
  expect(inboxHandlerTurnKind("slack-hook-evt")).toBeNull()
  expect(inboxHandlerTurnKind("cron-job-1")).toBeNull()
})
