import { describe, expect, test } from "bun:test"
import type { Subagent } from "../shared/types"
import { parseMentions } from "./mention-parser"

function subagent(name: string, id = name): Subagent {
  return {
    id,
    name,
    provider: "claude",
    model: "claude-opus-4-7",
    modelOptions: { reasoningEffort: "medium", contextWindow: "1m" },
    systemPrompt: "",
    contextScope: "previous-assistant-reply",
    createdAt: 1,
    updatedAt: 1,
  }
}

describe("parseMentions", () => {
  test("resolves @agent/<name> to subagent", () => {
    expect(parseMentions("hello @agent/reviewer please look", [subagent("reviewer")])).toEqual([
      { kind: "subagent", subagentId: "reviewer", raw: "@agent/reviewer" },
    ])
  })

  test("returns unknown-subagent when name missing", () => {
    expect(parseMentions("hi @agent/nobody", [])).toEqual([
      { kind: "unknown-subagent", name: "nobody", raw: "@agent/nobody" },
    ])
  })

  test("case-insensitive match", () => {
    expect(parseMentions("@agent/REVIEWER", [subagent("reviewer")])).toEqual([
      { kind: "subagent", subagentId: "reviewer", raw: "@agent/REVIEWER" },
    ])
  })

  test("multiple agents preserve order", () => {
    const mentions = parseMentions("@agent/a then @agent/b", [subagent("a"), subagent("b")])
    expect(mentions.map((mention) => mention.kind === "subagent" ? mention.subagentId : null)).toEqual(["a", "b"])
  })

  test("returns empty when no @agent/ mentions present", () => {
    expect(parseMentions("plain text", [subagent("reviewer")])).toEqual([])
  })

  test("does not match @agent/ without a name", () => {
    expect(parseMentions("hello @agent/ alone", [subagent("reviewer")])).toEqual([])
  })

  test("does not match mid-word", () => {
    expect(parseMentions("foo@agent/reviewer", [subagent("reviewer")])).toEqual([])
  })
})
