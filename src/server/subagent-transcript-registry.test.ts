import { describe, expect, test } from "bun:test"
import { createSubagentTranscriptRegistry } from "./subagent-transcript-registry"

// Real agent files are entirely isSidechain:true — the live parser drops them,
// so the registry must parse via normalizeClaudeStreamMessage directly.
const SIDECHAIN_LINES = [
  JSON.stringify({
    type: "assistant",
    uuid: "a1",
    isSidechain: true,
    message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "working on it" }] },
  }),
  JSON.stringify({
    type: "assistant",
    uuid: "a2",
    isSidechain: true,
    message: { model: "claude-sonnet-4-6", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/x" } }] },
  }),
  JSON.stringify({
    type: "user",
    uuid: "a3",
    isSidechain: true,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file body" }] },
  }),
]

describe("subagent-transcript-registry", () => {
  test("parses sidechain agent lines into transcript entries (text, tool_call, tool_result)", () => {
    const reg = createSubagentTranscriptRegistry({
      readAgentTranscriptLines: (dir, agentId) => (dir === "/sub" && agentId === "abc" ? SIDECHAIN_LINES : []),
    })
    reg.register("chat-1", "/sub")
    const entries = reg.getAgentTranscript("chat-1", "abc")
    expect(entries.map((e) => e.kind)).toEqual(["assistant_text", "tool_call", "tool_result"])
  })

  test("returns [] for an unknown chat (unregistered)", () => {
    const reg = createSubagentTranscriptRegistry({ readAgentTranscriptLines: () => SIDECHAIN_LINES })
    expect(reg.getAgentTranscript("nope", "abc")).toEqual([])
  })

  test("returns [] after unregister", () => {
    const reg = createSubagentTranscriptRegistry({ readAgentTranscriptLines: () => SIDECHAIN_LINES })
    reg.register("chat-1", "/sub")
    reg.unregister("chat-1")
    expect(reg.getAgentTranscript("chat-1", "abc")).toEqual([])
  })

  test("skips blank / unparseable lines without throwing", () => {
    const reg = createSubagentTranscriptRegistry({
      readAgentTranscriptLines: () => ["{not json", "", SIDECHAIN_LINES[0]],
    })
    reg.register("chat-1", "/sub")
    const entries = reg.getAgentTranscript("chat-1", "abc")
    expect(entries.map((e) => e.kind)).toEqual(["assistant_text"])
  })
})
