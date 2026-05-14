import { expect, test } from "bun:test"
import type { ToolRequest } from "./permission-policy"
import { POLICY_DEFAULT, POLICY_TERMINAL_STATUSES } from "./permission-policy"

test("default policy uses 'ask' verdict and has built-in deny patterns", () => {
  expect(POLICY_DEFAULT.defaultAction).toBe("ask")
  expect(POLICY_DEFAULT.readPathDeny).toContain("~/.ssh")
  expect(POLICY_DEFAULT.readPathDeny).toContain("~/.claude")
  expect(POLICY_DEFAULT.writePathDeny).toContain("/etc/**")
})

test("terminal statuses set includes timeout/canceled/arg_mismatch", () => {
  expect(POLICY_TERMINAL_STATUSES.has("answered")).toBe(true)
  expect(POLICY_TERMINAL_STATUSES.has("timeout")).toBe(true)
  expect(POLICY_TERMINAL_STATUSES.has("canceled")).toBe(true)
  expect(POLICY_TERMINAL_STATUSES.has("session_closed")).toBe(true)
  expect(POLICY_TERMINAL_STATUSES.has("arg_mismatch")).toBe(true)
})

test("ToolRequest type structurally requires canonicalArgsHash and toolName", () => {
  const req: ToolRequest = {
    id: "abc",
    chatId: "c1",
    sessionId: "s1",
    toolUseId: "tu1",
    toolName: "ask_user_question",
    arguments: {},
    canonicalArgsHash: "hash",
    policyVerdict: "ask",
    status: "pending",
    createdAt: 0,
    expiresAt: 0,
  }
  expect(req.id).toBe("abc")
})
