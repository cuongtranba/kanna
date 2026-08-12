import { describe, expect, test } from "bun:test"
import type { AgentProvider, TranscriptEntry } from "../shared/types"
import { buildHistoryPrimer, extractPreviousAssistantReply, PRIMER_MAX_CHARS, shouldInjectPrimer } from "./history-primer"

function userEntry(text: string, createdAt: number): TranscriptEntry {
  return { _id: `u-${createdAt}`, kind: "user_prompt", createdAt, content: text }
}

function assistantEntry(text: string, createdAt: number): TranscriptEntry {
  return { _id: `a-${createdAt}`, kind: "assistant_text", createdAt, text }
}

describe("shouldInjectPrimer", () => {
  test("true when target provider has no token", () => {
    expect(shouldInjectPrimer({ claude: "x" }, "codex", false)).toBe(true)
  })

  test("false when target provider has a token", () => {
    expect(shouldInjectPrimer({ claude: "x" }, "claude", false)).toBe(false)
  })

  test("true when userClearedContext is true regardless of token", () => {
    expect(shouldInjectPrimer({ claude: "x" }, "claude", true)).toBe(true)
  })

  test("true for first-ever chat (empty map)", () => {
    expect(shouldInjectPrimer({}, "claude", false)).toBe(true)
  })
})

describe("buildHistoryPrimer", () => {
  test("returns null when no assistant entries exist", () => {
    const entries: TranscriptEntry[] = [userEntry("hi", 1000)]
    expect(buildHistoryPrimer(entries, "codex" as AgentProvider, "next")).toBeNull()
  })

  test("renders user + assistant entries with tail", () => {
    const entries: TranscriptEntry[] = [
      userEntry("first", 1000),
      assistantEntry("reply", 2000),
    ]
    const primer = buildHistoryPrimer(entries, "codex" as AgentProvider, "now what?")!
    expect(primer).toContain("BEGIN PRIOR CONVERSATION")
    expect(primer).toContain("first")
    expect(primer).toContain("reply")
    expect(primer).toContain("END PRIOR CONVERSATION")
    expect(primer.endsWith("now what?")).toBe(true)
  })

  test("truncates oldest entries when over PRIMER_MAX_CHARS", () => {
    const entries: TranscriptEntry[] = []
    for (let i = 0; i < 200; i += 1) {
      entries.push(userEntry("u".repeat(800), i * 2))
      entries.push(assistantEntry("a".repeat(800), i * 2 + 1))
    }
    const primer = buildHistoryPrimer(entries, "codex" as AgentProvider, "tail")!
    expect(primer.length).toBeLessThanOrEqual(PRIMER_MAX_CHARS + 200)
    expect(primer).toContain("earlier conversation omitted")
  })
})

describe("extractPreviousAssistantReply", () => {
  test("returns null when no prior assistant reply", () => {
    const entries: TranscriptEntry[] = [userEntry("hi", 1000)]
    expect(extractPreviousAssistantReply(entries)).toBeNull()
  })

  test("returns last assistant text", () => {
    const entries: TranscriptEntry[] = [
      userEntry("hi", 1000),
      assistantEntry("first reply", 1100),
      userEntry("more", 1200),
      assistantEntry("second reply", 1300),
    ]
    expect(extractPreviousAssistantReply(entries)).toBe("second reply")
  })

  test("falls back to tool call summary if reply has no text", () => {
    const entries: TranscriptEntry[] = [
      userEntry("run x", 1000),
      {
        _id: "t1",
        kind: "tool_call",
        createdAt: 1100,
        tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: "x", input: { command: "ls" } },
      } as unknown as TranscriptEntry,
    ]
    expect(extractPreviousAssistantReply(entries)).toBe("Bash: ls")
  })
})

function clearedEntry(createdAt: number): TranscriptEntry {
  return { _id: `c-${createdAt}`, kind: "context_cleared", createdAt }
}

function boundaryEntry(createdAt: number): TranscriptEntry {
  return { _id: `b-${createdAt}`, kind: "compact_boundary", createdAt }
}

function summaryEntry(summary: string, createdAt: number): TranscriptEntry {
  return { _id: `s-${createdAt}`, kind: "compact_summary", createdAt, summary }
}

describe("buildHistoryPrimer — context resets", () => {
  test("returns null when the conversation ends at a context_cleared", () => {
    const entries: TranscriptEntry[] = [
      userEntry("old", 1000),
      assistantEntry("old reply", 2000),
      clearedEntry(3000),
    ]
    expect(buildHistoryPrimer(entries, "codex" as AgentProvider, "next")).toBeNull()
  })

  test("renders only what came after the last context_cleared", () => {
    const entries: TranscriptEntry[] = [
      userEntry("old", 1000),
      assistantEntry("old reply", 2000),
      clearedEntry(3000),
      userEntry("new", 4000),
      assistantEntry("new reply", 5000),
    ]
    const primer = buildHistoryPrimer(entries, "codex" as AgentProvider, "tail")!
    expect(primer).toContain("new reply")
    expect(primer).not.toContain("old reply")
    expect(primer).not.toContain("[user, 1970-01-01 00:00:01]\nold\n")
  })

  test("carries the compact summary that follows a boundary", () => {
    const entries: TranscriptEntry[] = [
      userEntry("old", 1000),
      assistantEntry("old reply", 2000),
      boundaryEntry(3000),
      summaryEntry("THE SUMMARY", 4000),
      userEntry("new", 5000),
    ]
    const primer = buildHistoryPrimer(entries, "codex" as AgentProvider, "tail")!
    expect(primer).toContain("THE SUMMARY")
    expect(primer).toContain("new")
    expect(primer).not.toContain("old reply")
  })

  test("hoists a compact summary that precedes its boundary", () => {
    const entries: TranscriptEntry[] = [
      userEntry("old", 1000),
      assistantEntry("old reply", 2000),
      summaryEntry("THE SUMMARY", 3000),
      boundaryEntry(4000),
      userEntry("new", 5000),
    ]
    const primer = buildHistoryPrimer(entries, "codex" as AgentProvider, "tail")!
    expect(primer).toContain("THE SUMMARY")
    expect(primer).not.toContain("old reply")
  })

  test("a context_cleared after a summary discards the summary too", () => {
    const entries: TranscriptEntry[] = [
      summaryEntry("THE SUMMARY", 1000),
      boundaryEntry(2000),
      clearedEntry(3000),
      userEntry("new", 4000),
      assistantEntry("new reply", 5000),
    ]
    const primer = buildHistoryPrimer(entries, "codex" as AgentProvider, "tail")!
    expect(primer).not.toContain("THE SUMMARY")
    expect(primer).toContain("new reply")
  })

  test("returns null when the post-reset slice holds no assistant content", () => {
    const entries: TranscriptEntry[] = [
      assistantEntry("old reply", 1000),
      clearedEntry(2000),
      userEntry("new", 3000),
    ]
    expect(buildHistoryPrimer(entries, "codex" as AgentProvider, "tail")).toBeNull()
  })
})
