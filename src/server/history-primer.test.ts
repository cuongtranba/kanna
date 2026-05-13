import { describe, expect, test } from "bun:test"
import type { AgentProvider, TranscriptEntry } from "../shared/types"
import { buildHistoryPrimer, PRIMER_MAX_CHARS, shouldInjectPrimer } from "./history-primer"

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
