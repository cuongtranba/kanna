import { expect, test } from "bun:test"
import { KANNA_SYSTEM_PROMPT_BASE } from "./kanna-system-prompt"
import { LINK_RULES_FOR_PARITY } from "./mermaidRepair"

/**
 * Kanna carries the same mermaid knowledge in two hand-maintained places: the
 * repair table, and the sentence in the system prompt that tells the model how
 * to avoid needing it. They drifted for four releases — the prompt named `()`
 * and `[]{}` while the failure users actually hit was a `/`-leading path label,
 * which neither list covered.
 *
 * These tests make the drift a build failure instead of a bug report. They gate
 * COVERAGE, not prose: reword the sentence freely, but a rule the repair knows
 * must be one the prompt warns about.
 */

/** Every character the model must quote inside a label, per mermaid's `text` lexer state. */
const LABEL_QUOTE_TRIGGERS = ["(", ")", "[", "]", "{", "}", "|", '"', "[/", "#quot;"] as const

test("the prompt warns about every character that forces a quoted label", () => {
  for (const trigger of LABEL_QUOTE_TRIGGERS) {
    expect(KANNA_SYSTEM_PROMPT_BASE).toContain(`\`${trigger}\``)
  }
})

test("the prompt spells out every link rule the repair knows how to fix", () => {
  for (const rule of LINK_RULES_FOR_PARITY) {
    expect(KANNA_SYSTEM_PROMPT_BASE).toContain(`\`${rule.from}\``)
    expect(KANNA_SYSTEM_PROMPT_BASE).toContain(`\`${rule.to}\``)
  }
})

test("the prompt points at the tool that would have caught all of it", () => {
  expect(KANNA_SYSTEM_PROMPT_BASE).toContain("mcp__kanna__validate_mermaid")
})
