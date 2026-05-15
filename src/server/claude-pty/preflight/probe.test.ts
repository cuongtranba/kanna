import { describe, expect, test } from "bun:test"
import { classifyProbeFromJsonlLines } from "./probe"

describe("classifyProbeFromJsonlLines", () => {
  test("pass when probe_unavailable tool_use for the target builtin", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{
            type: "tool_use",
            id: "x", name: "mcp__kanna__probe_unavailable",
            input: { tool: "Bash" },
          }],
        },
      }),
    ]
    const r = classifyProbeFromJsonlLines("Bash", lines)
    expect(r.kind).toBe("pass")
  })

  test("fail when target builtin tool_use observed", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "y", name: "Bash", input: { command: "echo hi" } }],
        },
      }),
    ]
    const r = classifyProbeFromJsonlLines("Bash", lines)
    expect(r.kind).toBe("fail")
    if (r.kind === "fail") expect(r.evidence).toContain("Bash")
  })

  test("fail when an unrelated disallowed built-in is observed", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "z", name: "Read", input: { path: "/x" } }],
        },
      }),
    ]
    const r = classifyProbeFromJsonlLines("Bash", lines)
    expect(r.kind).toBe("fail")
  })

  test("indeterminate when no probe_unavailable and no built-in tool_use", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I cannot do that." }],
        },
      }),
    ]
    const r = classifyProbeFromJsonlLines("Bash", lines)
    expect(r.kind).toBe("indeterminate")
  })

  test("ignores unrelated system/init events", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s", model: "x" }),
    ]
    const r = classifyProbeFromJsonlLines("Bash", lines)
    expect(r.kind).toBe("indeterminate")
  })
})
