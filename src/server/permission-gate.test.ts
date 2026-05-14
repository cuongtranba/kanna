import { describe, expect, test } from "bun:test"
import { policy } from "./permission-gate"
import { POLICY_DEFAULT } from "../shared/permission-policy"

describe("policy.evaluate basics", () => {
  test("defaultAction 'ask' → ask verdict", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__webfetch",
      args: { url: "https://example.com" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("ask")
  })

  test("defaultAction 'auto-allow' → auto-allow verdict", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__webfetch",
      args: { url: "https://example.com" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("auto-allow")
  })

  test("toolDenyList regex match → auto-deny with reason", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "rm -rf /" },
      chatPolicy: POLICY_DEFAULT,
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("auto-deny")
    expect(verdict.reason).toContain("denylist")
  })

  test("deny-list overrides defaultAction auto-allow", () => {
    const verdict = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "rm -rf /" },
      chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
      cwd: "/tmp",
    })
    expect(verdict.verdict).toBe("auto-deny")
  })
})
