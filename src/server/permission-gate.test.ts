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

describe("bash arg parsing", () => {
  const policyWithDefaults = POLICY_DEFAULT

  test("plain `ls` → auto-allow", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "ls" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-allow")
  })

  test("`cat ~/.ssh/id_rsa` → auto-deny (readPathDeny)", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "cat ~/.ssh/id_rsa" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
    expect(v.reason).toContain("readPathDeny")
  })

  test("`cat ~/.claude/.credentials.json` → auto-deny", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "cat ~/.claude/.credentials.json" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-deny")
  })

  test("pipe `ls | grep foo` → ask (downgrades)", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "ls | grep foo" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("subshell `cat $(echo ~/.ssh/id_rsa)` → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "cat $(echo ~/.ssh/id_rsa)" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("env-prefix `FOO=bar ls` → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "FOO=bar ls" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("chain `ls && rm file` → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "ls && rm file" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })

  test("`git status` (multi-word verb in autoAllowVerbs) → auto-allow", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "git status" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("auto-allow")
  })

  test("unrecognized verb → ask", () => {
    const v = policy.evaluate({
      toolName: "mcp__kanna__bash",
      args: { command: "curl https://example.com" },
      chatPolicy: policyWithDefaults,
      cwd: "/tmp/project",
    })
    expect(v.verdict).toBe("ask")
  })
})
