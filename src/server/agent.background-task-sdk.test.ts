import { describe, expect, test } from "bun:test"
import { backgroundTaskIdsFromToolResult } from "./agent"

// The background-task keep-alive guard lives in the shared runClaudeSession
// consume loop, so it applies to SDK sessions too — the SDK normalizes a
// `Bash(run_in_background)` result to the SAME CLI text the PTY transcript
// carries. These tests pin that the detector recognizes both content shapes
// the SDK can produce (a plain string and an array of text blocks), which is
// the only driver-specific risk for SDK parity on this feature.
describe("backgroundTaskIdsFromToolResult (SDK parity)", () => {
  test("detects id from string content", () => {
    const content = "Command running in background with ID: bg_abc123\n"
    expect(backgroundTaskIdsFromToolResult(content)).toEqual(["bg_abc123"])
  })

  test("detects id from content-block array shape", () => {
    const content = [{ type: "text", text: "Command running in background with ID: bg_xyz789" }]
    expect(backgroundTaskIdsFromToolResult(content)).toEqual(["bg_xyz789"])
  })

  test("captures multiple launches in one result", () => {
    const content =
      "Command running in background with ID: bg_one\nCommand running in background with ID: bg_two\n"
    expect(backgroundTaskIdsFromToolResult(content)).toEqual(["bg_one", "bg_two"])
  })

  test("no false positive on ordinary tool_result", () => {
    expect(backgroundTaskIdsFromToolResult("done\n")).toEqual([])
    expect(backgroundTaskIdsFromToolResult([{ type: "text", text: "ok" }])).toEqual([])
    expect(backgroundTaskIdsFromToolResult(null)).toEqual([])
  })
})
