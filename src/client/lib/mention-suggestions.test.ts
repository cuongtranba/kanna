import { describe, expect, test } from "bun:test"
import { applyMentionToInput, shouldShowMentionPicker } from "./mention-suggestions"

describe("shouldShowMentionPicker", () => {
  test("opens on bare @ at start", () => {
    expect(shouldShowMentionPicker("@", 1)).toEqual({ open: true, query: "", tokenStart: 0 })
  })

  test("opens on @src at start", () => {
    expect(shouldShowMentionPicker("@src", 4)).toEqual({ open: true, query: "src", tokenStart: 0 })
  })

  test("opens on @src after space", () => {
    expect(shouldShowMentionPicker("hi @src", 7)).toEqual({ open: true, query: "src", tokenStart: 3 })
  })

  test("opens after newline", () => {
    expect(shouldShowMentionPicker("hi\n@src", 7)).toEqual({ open: true, query: "src", tokenStart: 3 })
  })

  test("does not open on mid-word @ (email-like)", () => {
    expect(shouldShowMentionPicker("foo@bar", 7)).toEqual({ open: false, query: "", tokenStart: -1 })
  })

  test("does not open when caret before @", () => {
    expect(shouldShowMentionPicker("@src", 0)).toEqual({ open: false, query: "", tokenStart: -1 })
  })

  test("does not open after space breaks the token", () => {
    expect(shouldShowMentionPicker("@src foo", 8)).toEqual({ open: false, query: "", tokenStart: -1 })
  })

  test("does not open on empty input", () => {
    expect(shouldShowMentionPicker("", 0)).toEqual({ open: false, query: "", tokenStart: -1 })
  })
})

describe("applyMentionToInput", () => {
  test("replaces @query at start with @pickedPath", () => {
    const result = applyMentionToInput({
      value: "@src",
      caret: 4,
      tokenStart: 0,
      pickedPath: "src/agent.ts",
    })
    expect(result.value).toBe("@src/agent.ts")
    expect(result.caret).toBe("@src/agent.ts".length)
  })

  test("replaces mid-input token", () => {
    const result = applyMentionToInput({
      value: "hi @src tail",
      caret: 7,
      tokenStart: 3,
      pickedPath: "src/agent.ts",
    })
    expect(result.value).toBe("hi @src/agent.ts tail")
    expect(result.caret).toBe("hi @src/agent.ts".length)
  })

  test("preserves bare @ with empty query", () => {
    const result = applyMentionToInput({
      value: "@",
      caret: 1,
      tokenStart: 0,
      pickedPath: "README.md",
    })
    expect(result.value).toBe("@README.md")
    expect(result.caret).toBe("@README.md".length)
  })

  test("handles dir paths (trailing slash)", () => {
    const result = applyMentionToInput({
      value: "@src",
      caret: 4,
      tokenStart: 0,
      pickedPath: "src/",
    })
    expect(result.value).toBe("@src/")
    expect(result.caret).toBe("@src/".length)
  })
})
