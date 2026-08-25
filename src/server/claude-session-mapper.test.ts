import { describe, expect, test } from "bun:test"
import {
  claudeRecordKey,
  claudeRecordKeyFromEntryId,
  mapClaudeRecordsToEntries,
} from "./claude-session-mapper"
import type { ClaudeSessionRecord } from "./claude-session-types"

describe("mapClaudeRecordsToEntries", () => {
  const baseTs = "2026-04-20T10:00:00.000Z"

  test("user message → user_prompt entry", () => {
    const records: ClaudeSessionRecord[] = [
      { type: "user", uuid: "u1", timestamp: baseTs, message: { role: "user", content: "hello" } },
    ]
    const entries = mapClaudeRecordsToEntries(records)
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("user_prompt")
    if (entries[0].kind === "user_prompt") {
      expect(entries[0].content).toBe("hello")
    }
  })

  test("assistant text → assistant_text entry", () => {
    const records: ClaudeSessionRecord[] = [
      {
        type: "assistant",
        uuid: "a1",
        timestamp: baseTs,
        message: { role: "assistant", id: "m1", content: [{ type: "text", text: "hi" }] },
      },
    ]
    const entries = mapClaudeRecordsToEntries(records)
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("assistant_text")
    if (entries[0].kind === "assistant_text") {
      expect(entries[0].text).toBe("hi")
    }
  })

  test("assistant tool_use → tool_call entry with normalized Bash tool", () => {
    const records: ClaudeSessionRecord[] = [
      {
        type: "assistant",
        uuid: "a2",
        timestamp: baseTs,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "ls" } }],
        },
      },
    ]
    const entries = mapClaudeRecordsToEntries(records)
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("tool_call")
    if (entries[0].kind === "tool_call") {
      expect(entries[0].tool.toolKind).toBe("bash")
      expect(entries[0].tool.toolId).toBe("tu-1")
    }
  })

  test("user tool_result → tool_result entry", () => {
    const records: ClaudeSessionRecord[] = [
      {
        type: "user",
        uuid: "u1",
        timestamp: baseTs,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu-1", content: "file1\nfile2" }],
        },
      },
    ]
    const entries = mapClaudeRecordsToEntries(records)
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("tool_result")
    if (entries[0].kind === "tool_result") {
      expect(entries[0].toolId).toBe("tu-1")
      expect(entries[0].content).toBe("file1\nfile2")
    }
  })

  test("user tool_result carrying a sibling toolUseResult (Task/Agent tool) → entry.debugRaw round-trips agentId", () => {
    const records: ClaudeSessionRecord[] = [
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
    ]
    const entries = mapClaudeRecordsToEntries(records)
    expect(entries.length).toBe(1)
    expect(entries[0].kind).toBe("tool_result")
    if (entries[0].kind === "tool_result") {
      expect(entries[0].debugRaw).toBeDefined()
      const parsed = JSON.parse(entries[0].debugRaw ?? "{}")
      expect(parsed.toolUseResult.agentId).toBe("agent-abc123")
    }
  })

  /**
   * The inverse property. `claudeRecordKeyFromEntryId` must recover
   * `claudeRecordKey` from every `_id` the mapper mints — the importer's delta
   * check reads a record as NEW when its key is not among the recovered ones,
   * so a single suffix the regex cannot parse re-appends the whole transcript
   * on every live-tail tick, silently.
   */
  describe("claudeRecordKeyFromEntryId inverts claudeRecordKey", () => {
    // Real v4 uuids: they contain dashes, which is what the closed suffix set
    // in the regex exists to survive.
    const UUID_USER = "9f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"
    const UUID_ASSISTANT = "1a7d4f30-2b55-4e91-8c03-77de2b9a4c10"
    const UUID_RESULT = "c0ffee00-dead-4bee-8fed-0123456789ab"

    const records: ClaudeSessionRecord[] = [
      { type: "user", uuid: UUID_USER, timestamp: baseTs, message: { role: "user", content: "hello" } },
      {
        type: "assistant",
        uuid: UUID_ASSISTANT,
        timestamp: baseTs,
        message: {
          role: "assistant",
          id: "m1",
          content: [
            { type: "text", text: "first" },
            { type: "tool_use", id: "tu-1", name: "Bash", input: { command: "ls" } },
            { type: "text", text: "second" },
          ],
        },
      },
      {
        type: "user",
        uuid: UUID_RESULT,
        timestamp: baseTs,
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu-1", content: "out" },
            { type: "tool_result", tool_use_id: "tu-2", content: "out2" },
          ],
        },
      },
      { type: "summary", uuid: "s1", summary: "skipped" },
    ]

    test("every entry recovers the key of the record that produced it", () => {
      const all = mapClaudeRecordsToEntries(records)
      expect(all.length).toBe(6)

      // Map each record alone to learn which entries it owns, then assert the
      // inverse against the ids minted in the full-set mapping.
      let cursor = 0
      for (const record of records) {
        const owned = mapClaudeRecordsToEntries([record])
        const expected = claudeRecordKey(record)
        for (const _ of owned) {
          const entry = all[cursor]
          cursor += 1
          expect(claudeRecordKeyFromEntryId(entry._id)).toBe(expected)
        }
      }
      expect(cursor).toBe(all.length)
    })

    test("the recovered key set is exactly the mapped records' keys", () => {
      const recovered = new Set(
        mapClaudeRecordsToEntries(records).map((entry) => claudeRecordKeyFromEntryId(entry._id)),
      )
      expect(recovered).toEqual(new Set([UUID_USER, UUID_ASSISTANT, UUID_RESULT]))
    })

    test("a record with no uuid has no key, and its entry id recovers something else (always-new)", () => {
      const record: ClaudeSessionRecord = {
        type: "user",
        timestamp: baseTs,
        message: { role: "user", content: "no uuid" },
      }
      expect(claudeRecordKey(record)).toBeNull()
      const [entry] = mapClaudeRecordsToEntries([record])
      // Documented behaviour: the mapper mints a random prefix, so no stored
      // entry can ever match this record — the importer treats it as new.
      expect(claudeRecordKeyFromEntryId(entry._id)).not.toBeNull()
      expect(claudeRecordKeyFromEntryId(entry._id)).not.toBe(claudeRecordKey(record))
    })
  })

  test("skips summary and system records", () => {
    const records: ClaudeSessionRecord[] = [
      { type: "summary", summary: "x" },
      { type: "system", content: "y" },
      { type: "user", uuid: "u1", timestamp: baseTs, message: { role: "user", content: "hi" } },
    ]
    const entries = mapClaudeRecordsToEntries(records)
    expect(entries.length).toBe(1)
  })
})
