import { describe, expect, test } from "bun:test"
import { parseAgentTranscriptLines } from "./agent-transcript-parse"

describe("parseAgentTranscriptLines", () => {
  test("normalizes assistant text lines into transcript entries", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { id: "m1", content: [{ type: "text", text: "hello" }] },
    })
    const entries = parseAgentTranscriptLines([line])
    expect(entries.length).toBe(1)
    expect(entries[0]?.kind).toBe("assistant_text")
  })

  test("skips corrupt, non-object, and unparseable lines without aborting", () => {
    const good = JSON.stringify({
      type: "assistant",
      message: { id: "m1", content: [{ type: "text", text: "kept" }] },
    })
    const entries = parseAgentTranscriptLines(['{"truncated', '"just a string"', "42", good])
    expect(entries.length).toBe(1)
  })

  test("returns [] for no lines", () => {
    expect(parseAgentTranscriptLines([])).toEqual([])
  })
})
