import { describe, expect, test } from "bun:test"
import { backgroundTaskIdsFromToolResult } from "./agent"

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
