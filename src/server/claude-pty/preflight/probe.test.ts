import { describe, expect, test } from "bun:test"
import { classifyProbeFromJsonlLines } from "./probe"

describe("classifyProbeFromJsonlLines", () => {
  test("pass when assistant turn has text only (no tool_use)", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Bash is not available to me." }],
        },
      }),
    ]
    const r = classifyProbeFromJsonlLines("Bash", lines)
    expect(r.kind).toBe("pass")
    if (r.kind === "pass") expect(r.evidence).toBe("no_builtin_tool_use_in_assistant_turn")
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

  test("indeterminate when no assistant turn", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s", model: "x" }),
    ]
    const r = classifyProbeFromJsonlLines("Bash", lines)
    expect(r.kind).toBe("indeterminate")
    if (r.kind === "indeterminate") expect(r.reason).toContain("no assistant turn")
  })

  test("ignores unrelated system/init events", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s", model: "x" }),
    ]
    const r = classifyProbeFromJsonlLines("Bash", lines)
    expect(r.kind).toBe("indeterminate")
  })
})
