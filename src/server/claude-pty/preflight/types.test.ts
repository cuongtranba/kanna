import { describe, expect, test } from "bun:test"
import type { ProbeResult, AllowlistCacheKey, SuiteResult } from "./types"
import { DISALLOWED_BUILTINS } from "./types"

describe("preflight types", () => {
  test("DISALLOWED_BUILTINS contains all 8 built-ins", () => {
    expect(DISALLOWED_BUILTINS).toEqual([
      "Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch",
    ])
  })

  test("ProbeResult discriminates pass/fail/indeterminate", () => {
    const pass: ProbeResult = { kind: "pass", builtin: "Bash", evidence: "probe_unavailable" }
    const fail: ProbeResult = { kind: "fail", builtin: "Bash", evidence: "tool_use:Bash" }
    const ind: ProbeResult = { kind: "indeterminate", builtin: "Bash", reason: "timeout" }
    expect(pass.kind).toBe("pass")
    expect(fail.kind).toBe("fail")
    expect(ind.kind).toBe("indeterminate")
  })

  test("AllowlistCacheKey requires all three fields", () => {
    const k: AllowlistCacheKey = {
      binarySha256: "abc",
      toolsString: "mcp__kanna__*",
      systemInitModel: "claude-opus-4-7",
    }
    expect(k.binarySha256).toBe("abc")
  })

  test("SuiteResult includes timestamp and per-probe outcomes", () => {
    const s: SuiteResult = {
      key: { binarySha256: "x", toolsString: "y", systemInitModel: "z" },
      verdict: "pass",
      probes: [],
      probedAt: 100,
    }
    expect(s.verdict).toBe("pass")
  })
})
