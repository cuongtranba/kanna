import { describe, expect, test } from "bun:test"
import type { JsonObject } from "../shared/json"
import { decodeClaudeSessionRecord } from "./claude-session-decode"
import { mapClaudeRecordsToEntries, sourceUuidOfEntryId } from "./claude-session-mapper"

function mapLines(lines: JsonObject[]) {
  const records = lines.flatMap((line) => decodeClaudeSessionRecord(line) ?? [])
  return mapClaudeRecordsToEntries(records)
}

describe("mapClaudeRecordsToEntries", () => {
  const baseTs = "2026-04-20T10:00:00.000Z"

  test("user message → user_prompt entry", () => {
    const entries = mapLines([
      { type: "user", uuid: "u1", timestamp: baseTs, message: { role: "user", content: "hello" } },
    ])
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("user_prompt")
    if (entries[0].kind === "user_prompt") {
      expect(entries[0].content).toBe("hello")
    }
  })

  test("assistant text → assistant_text entry", () => {
    const entries = mapLines([
      {
        type: "assistant",
        uuid: "a1",
        timestamp: baseTs,
        message: { role: "assistant", id: "m1", content: [{ type: "text", text: "hi" }] },
      },
    ])
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("assistant_text")
    if (entries[0].kind === "assistant_text") {
      expect(entries[0].text).toBe("hi")
    }
  })

  test("assistant tool_use → tool_call entry with normalized Bash tool", () => {
    const entries = mapLines([
      {
        type: "assistant",
        uuid: "a2",
        timestamp: baseTs,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "ls" } }],
        },
      },
    ])
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("tool_call")
    if (entries[0].kind === "tool_call") {
      expect(entries[0].tool.toolKind).toBe("bash")
      expect(entries[0].tool.toolId).toBe("tu-1")
    }
  })

  test("user tool_result → tool_result entry", () => {
    const entries = mapLines([
      {
        type: "user",
        uuid: "u1",
        timestamp: baseTs,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu-1", content: "file1\nfile2" }],
        },
      },
    ])
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("tool_result")
    if (entries[0].kind === "tool_result") {
      expect(entries[0].toolId).toBe("tu-1")
      expect(entries[0].content).toBe("file1\nfile2")
    }
  })

  test("user tool_result carrying a sibling toolUseResult (Task/Agent tool) → entry.debugRaw round-trips agentId", () => {
    const entries = mapLines([
      {
        type: "user",
        uuid: "u2",
        timestamp: baseTs,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu-1", content: "done" }],
        },
        toolUseResult: { agentId: "agent-abc123", agentType: "Hunter", status: "completed" },
      },
    ])
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("tool_result")
    if (entries[0].kind === "tool_result") {
      expect(entries[0].debugRaw).toBeDefined()
      const parsed = JSON.parse(entries[0].debugRaw ?? "{}")
      expect(parsed.toolUseResult.agentId).toBe("agent-abc123")
    }
  })

  test("skips summary and system records", () => {
    const entries = mapLines([
      { type: "summary", summary: "x" },
      { type: "system", content: "y" },
      { type: "user", uuid: "u1", timestamp: baseTs, message: { role: "user", content: "hi" } },
    ])
    expect(entries.length).toBe(1)
  })

  test("a user line with no message is skipped instead of aborting the import", () => {
    const entries = mapLines([
      { type: "user", uuid: "bad", timestamp: baseTs },
      { type: "user", uuid: "u1", timestamp: baseTs, message: { role: "user", content: "hi" } },
    ])
    expect(entries.length).toBe(1)
  })

  test("every mapped entry id resolves back to its source record uuid", () => {
    const entries = mapLines([
      { type: "user", uuid: "u-1", message: { content: "hi" } },
      {
        type: "assistant",
        uuid: "a-1",
        message: {
          content: [
            { type: "text", text: "hi" },
            { type: "tool_use", id: "tu-1", name: "Bash", input: { command: "ls" } },
          ],
        },
      },
      { type: "user", uuid: "u-2", message: { content: [{ type: "tool_result", tool_use_id: "tu-1", content: "ok" }] } },
    ])
    expect(entries.map((entry) => sourceUuidOfEntryId(entry._id))).toEqual(["u-1", "a-1", "a-1", "u-2"])
    expect(sourceUuidOfEntryId("not-an-imported-id")).toBeNull()
  })
})
