import { expect, test } from "bun:test"
import { KANNA_SYSTEM_PROMPT_BASE } from "./kanna-system-prompt"
import { LINK_RULES_FOR_PARITY } from "./mermaidRepair"


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
