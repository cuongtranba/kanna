import { test, expect } from "bun:test"
import { buildAgentDefinitions, sanitizeAgentKey } from "./agent-definitions"
import type { Subagent } from "../../shared/types"

const sub = (over: Partial<Subagent>): Subagent => ({
  id: "s1", name: "code reviewer", description: "reviews code", provider: "claude",
  model: "claude-sonnet-4-6", modelOptions: {}, systemPrompt: "You review code.",
  contextScope: "previous-assistant-reply", triggerMode: "auto",
  createdAt: 0, updatedAt: 0, ...over,
} as Subagent)

test("maps claude subagent to AgentDefinition keyed by sanitized name", () => {
  const defs = buildAgentDefinitions([sub({})])
  expect(defs["code-reviewer"]).toEqual({
    description: "reviews code",
    prompt: "You review code.",
    model: "claude-sonnet-4-6",
  })
})

test("excludes non-claude subagents", () => {
  expect(buildAgentDefinitions([sub({ provider: "codex" })])).toEqual({})
})

test("empty description falls back to name", () => {
  const defs = buildAgentDefinitions([sub({ description: undefined })])
  expect(defs["code-reviewer"]!.description).toBe("code reviewer")
})

test("duplicate sanitized keys: last updatedAt wins", () => {
  const a = sub({ id: "a", name: "Code Reviewer", updatedAt: 1 })
  const b = sub({ id: "b", name: "code-reviewer", systemPrompt: "B", updatedAt: 2 })
  expect(buildAgentDefinitions([a, b])["code-reviewer"]!.prompt).toBe("B")
})

test("sanitizeAgentKey", () => {
  expect(sanitizeAgentKey("Code Reviewer!")).toBe("code-reviewer")
})
