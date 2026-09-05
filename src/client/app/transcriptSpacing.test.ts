import { describe, expect, test } from "bun:test"
import type { HydratedTranscriptMessage } from "../../shared/transcript-types"
import { buildResolvedTranscriptRows } from "./KannaTranscript"
import {
  TRANSCRIPT_GAP_CLASS,
  TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND,
  TRANSCRIPT_RULE_CLASS,
  buildTranscriptGapClassMap,
  getTranscriptGapAboveForTones,
  transcriptGapHasRule,
  type TranscriptRowTone,
} from "./transcriptSpacing"

const ALL_TONES: TranscriptRowTone[] = ["user", "assistant", "tool", "chrome", "card"]

describe("getTranscriptGapAboveForTones", () => {
  test("the first row has no gap above it", () => {
    for (const tone of ALL_TONES) {
      expect(getTranscriptGapAboveForTones(null, tone)).toBe(0)
    }
  })

  test("consecutive tool activity collapses to zero", () => {
    expect(getTranscriptGapAboveForTones("tool", "tool")).toBe(0)
  })

  test("tool activity hugs the assistant prose it belongs to", () => {
    expect(getTranscriptGapAboveForTones("assistant", "tool")).toBe(4)
    expect(getTranscriptGapAboveForTones("tool", "assistant")).toBe(4)
  })

  test("a new user turn gets full separation from what came before", () => {
    expect(getTranscriptGapAboveForTones("assistant", "user")).toBe(32)
    expect(getTranscriptGapAboveForTones("tool", "user")).toBe(32)
    expect(getTranscriptGapAboveForTones("user", "tool")).toBe(32)
  })

  test("stacked user messages stay tight", () => {
    expect(getTranscriptGapAboveForTones("user", "user")).toBe(4)
  })

  test("assistant prose blocks breathe less than turn boundaries", () => {
    expect(getTranscriptGapAboveForTones("assistant", "assistant")).toBe(12)
  })

  test("chrome dividers get their own reduced air on both sides", () => {
    expect(getTranscriptGapAboveForTones("assistant", "chrome")).toBe(8)
    expect(getTranscriptGapAboveForTones("chrome", "assistant")).toBe(8)
    expect(getTranscriptGapAboveForTones("tool", "chrome")).toBe(8)
    expect(getTranscriptGapAboveForTones("chrome", "chrome")).toBe(8)
  })

  test("chrome beats the tool-run rule so a result still separates from its tools", () => {
    expect(getTranscriptGapAboveForTones("chrome", "tool")).toBe(8)
  })

  test("cards fall back to the default rhythm", () => {
    expect(getTranscriptGapAboveForTones("card", "card")).toBe(32)
    expect(getTranscriptGapAboveForTones("assistant", "card")).toBe(32)
  })

  test("every tone pair resolves to a value on the design spacing scale", () => {
    const allowed = new Set([0, 4, 8, 12, 16, 24, 32])
    for (const above of [...ALL_TONES, null]) {
      for (const below of ALL_TONES) {
        expect(allowed.has(getTranscriptGapAboveForTones(above, below))).toBe(true)
      }
    }
  })
})

describe("TRANSCRIPT_GAP_CLASS", () => {
  test("maps every gap value to a literal static class", () => {
    expect(TRANSCRIPT_GAP_CLASS[0]).toBe("pt-0")
    expect(TRANSCRIPT_GAP_CLASS[4]).toBe("pt-1")
    expect(TRANSCRIPT_GAP_CLASS[8]).toBe("pt-2")
    expect(TRANSCRIPT_GAP_CLASS[12]).toBe("pt-3")
    expect(TRANSCRIPT_GAP_CLASS[16]).toBe("pt-4")
    expect(TRANSCRIPT_GAP_CLASS[24]).toBe("pt-6")
    for (const value of Object.values(TRANSCRIPT_GAP_CLASS)) {
      expect(value).not.toContain("[")
    }
  })

  test("covers every gap the table can produce", () => {
    for (const above of [...ALL_TONES, null]) {
      for (const below of ALL_TONES) {
        expect(TRANSCRIPT_GAP_CLASS[getTranscriptGapAboveForTones(above, below)]).toBeString()
      }
    }
  })
})

describe("buildTranscriptGapClassMap over real resolved rows", () => {
  const at = (index: number) => new Date(1700000000000 + index * 1000).toISOString()

  function userPrompt(id: string): HydratedTranscriptMessage {
    return { id, kind: "user_prompt", content: `ask ${id}`, timestamp: at(0) }
  }

  function assistantText(id: string): HydratedTranscriptMessage {
    return { id, kind: "assistant_text", text: `say ${id}`, timestamp: at(1) }
  }

  function bashTool(id: string): HydratedTranscriptMessage {
    return {
      id,
      kind: "tool",
      toolKind: "bash",
      toolName: "Bash",
      toolId: id,
      input: { command: `echo ${id}`, description: `Run ${id}` },
      timestamp: at(2),
    }
  }

  function gapsFor(messages: HydratedTranscriptMessage[]) {
    const rows = buildResolvedTranscriptRows(messages, {
      isLoading: false,
      latestToolIds: { AskUserQuestion: null, ExitPlanMode: null, TodoWrite: null },
    })
    const gapById = buildTranscriptGapClassMap(rows)
    return rows.map((row) => gapById.get(row.id))
  }

  test("the plate rule never introduces a gap below", () => {
    expect(TRANSCRIPT_RULE_CLASS).not.toMatch(/\bborder-b\b/)
    expect(TRANSCRIPT_RULE_CLASS).not.toMatch(/\bpb-/)
    expect(TRANSCRIPT_RULE_CLASS).not.toMatch(/\bmb-/)
    for (const gapClass of Object.values(TRANSCRIPT_GAP_CLASS)) {
      expect(gapClass).toMatch(/^pt-/)
    }
  })

  test("only a turn boundary carries the rule", () => {
    const ruled = ([0, 4, 8, 12, 16, 24, 32] as const).filter(transcriptGapHasRule)
    expect(ruled).toEqual([32])
  })

  test("the first row never carries a gap", () => {
    expect(gapsFor([userPrompt("u1")])[0]).toBe("pt-0")
  })

  test("a user turn followed by assistant prose then tools reads as one descending block", () => {
    const gaps = gapsFor([
      userPrompt("u1"),
      assistantText("a1"),
      bashTool("t1"),
      bashTool("t2"),
      bashTool("t3"),
    ])
    expect(gaps[0]).toBe("pt-0")
    expect(gaps[1]).toContain("pt-8")
    expect(gaps[2]).toBe("pt-1")
    expect(gaps[1]).toContain("before:bg-border")
    expect(gaps[2]).not.toContain("before:bg-border")
  })

  test("a second user turn is fully separated from the tools above it", () => {
    const gaps = gapsFor([userPrompt("u1"), bashTool("t1"), userPrompt("u2")])
    expect(gaps.at(-1)).toContain("pt-8")
    expect(gaps.at(-1)).toContain("before:bg-border")
  })

  test("every row receives a gap class", () => {
    const gaps = gapsFor([
      userPrompt("u1"),
      assistantText("a1"),
      bashTool("t1"),
      bashTool("t2"),
      userPrompt("u2"),
      assistantText("a2"),
    ])
    for (const gap of gaps) expect(gap).toBeString()
  })
})

describe("TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND", () => {
  const EVERY_KIND: HydratedTranscriptMessage["kind"][] = [
    "user_prompt",
    "system_init",
    "account_info",
    "assistant_text",
    "assistant_thinking",
    "api_error",
    "policy_refusal",
    "result",
    "status",
    "context_window_updated",
    "compact_boundary",
    "compact_summary",
    "context_cleared",
    "interrupted",
    "memory_loaded",
    "unknown",
    "auto_continue_prompt",
    "pending_tool_request",
    "tool",
  ]

  test("assigns a tone to every message kind", () => {
    for (const kind of EVERY_KIND) {
      expect(ALL_TONES).toContain(TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND[kind])
    }
  })

  test("classifies the load-bearing kinds", () => {
    expect(TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND.user_prompt).toBe("user")
    expect(TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND.assistant_text).toBe("assistant")
    expect(TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND.assistant_thinking).toBe("assistant")
    expect(TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND.tool).toBe("tool")
    expect(TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND.result).toBe("chrome")
    expect(TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND.context_cleared).toBe("chrome")
    expect(TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND.compact_boundary).toBe("chrome")
    expect(TRANSCRIPT_ROW_TONE_BY_MESSAGE_KIND.api_error).toBe("card")
  })
})
