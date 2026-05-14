import { describe, expect, test } from "bun:test"
import type { Subagent } from "../../shared/types"
import { filterSubagentSuggestions } from "./useSubagentSuggestions"

function subagent(name: string): Subagent {
  return {
    id: name,
    name,
    provider: "claude",
    model: "claude-opus-4-7",
    modelOptions: { reasoningEffort: "medium", contextWindow: "200k" },
    systemPrompt: "",
    contextScope: "previous-assistant-reply",
    createdAt: 1,
    updatedAt: 1,
  }
}

describe("filterSubagentSuggestions", () => {
  test("suggests agents while typing @agent/<name>", () => {
    expect(filterSubagentSuggestions([subagent("reviewer"), subagent("planner")], "agent/rev")).toEqual([
      { kind: "agent", subagent: subagent("reviewer") },
    ])
  })

  test("suggests agents while typing the agent namespace prefix", () => {
    expect(filterSubagentSuggestions([subagent("reviewer")], "ag")).toHaveLength(1)
  })

  test("does not suggest agents for normal path mention queries", () => {
    expect(filterSubagentSuggestions([subagent("reviewer")], "src")).toEqual([])
  })
})
