import { describe, expect, test } from "bun:test"
import path from "node:path"
import { parseClaudeSessionFile } from "./claude-session-parser"

const FIXTURE_DIR = path.join(__dirname, "__fixtures__")

describe("parseClaudeSessionFile", () => {
  test("parses valid session with user, assistant, tool_use, tool_result", () => {
    const parsed = parseClaudeSessionFile(path.join(FIXTURE_DIR, "claude-session-valid.jsonl"))
    expect(parsed).not.toBeNull()
    if (!parsed) return
    expect(parsed.sessionId).toBe("sess-abc")
    expect(parsed.cwd).toBe("/tmp/kanna-test-proj")
    expect(parsed.records.length).toBe(6)
    expect(parsed.firstTimestamp).toBeGreaterThan(0)
    expect(parsed.lastTimestamp).toBeGreaterThanOrEqual(parsed.firstTimestamp)
  })
})
