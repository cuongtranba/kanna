import { describe, expect, test } from "bun:test"
import {
  BUILTIN_SLASH_COMMANDS,
  buildCodexCompactPrompt,
  parseBuiltinCommand,
} from "./builtin-commands"

describe("parseBuiltinCommand", () => {
  test("parses /clear", () => {
    expect(parseBuiltinCommand("/clear")).toEqual({ name: "clear" })
  })

  test("tolerates the trailing space the typeahead always appends", () => {
    expect(parseBuiltinCommand("  /clear  ")).toEqual({ name: "clear" })
  })

  test("refuses /clear with arguments rather than discarding them", () => {
    expect(parseBuiltinCommand("/clear now")).toBeNull()
  })

  test("parses /compact with no instructions", () => {
    expect(parseBuiltinCommand("/compact")).toEqual({ name: "compact", instructions: "" })
  })

  test("captures /compact instructions verbatim", () => {
    expect(parseBuiltinCommand("/compact focus on the auth bug")).toEqual({
      name: "compact",
      instructions: "focus on the auth bug",
    })
  })

  test("collapses surrounding whitespace in instructions only at the edges", () => {
    expect(parseBuiltinCommand("/compact   keep  the  spacing   ")).toEqual({
      name: "compact",
      instructions: "keep  the  spacing",
    })
  })

  test.each([
    ["/compactify"],
    ["/clearance"],
    ["//clear"],
    ["/Clear"],
    ["/COMPACT"],
    ["tell me about /clear"],
    ["clear"],
    [""],
    ["/"],
  ])("returns null for %p", (content) => {
    expect(parseBuiltinCommand(content)).toBeNull()
  })

  test("multi-line content never matches — a builtin is the whole message", () => {
    expect(parseBuiltinCommand("/clear\nand also do this")).toBeNull()
    expect(parseBuiltinCommand("/compact focus\non auth")).toBeNull()
  })
})

describe("BUILTIN_SLASH_COMMANDS", () => {
  test("every catalog entry is parseable — catalog and parser cannot drift", () => {
    for (const command of BUILTIN_SLASH_COMMANDS) {
      expect(parseBuiltinCommand(`/${command.name}`)).not.toBeNull()
    }
  })

  test("every entry is a builtin-scoped command", () => {
    for (const command of BUILTIN_SLASH_COMMANDS) {
      expect(command.scope).toBe("builtin")
      expect(command.kind).toBe("command")
      expect(command.description.length).toBeGreaterThan(0)
    }
  })

  test("only compact advertises an argument", () => {
    const byName = new Map(BUILTIN_SLASH_COMMANDS.map((c) => [c.name, c]))
    expect(byName.get("clear")?.argumentHint).toBe("")
    expect(byName.get("compact")?.argumentHint).not.toBe("")
  })

  test("names carry no leading slash — the UI adds it", () => {
    for (const command of BUILTIN_SLASH_COMMANDS) {
      expect(command.name.startsWith("/")).toBe(false)
    }
  })
})

describe("buildCodexCompactPrompt", () => {
  test("produces a non-empty summarization instruction with no instructions", () => {
    const prompt = buildCodexCompactPrompt("")
    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt.toLowerCase()).toContain("summar")
  })

  test("embeds the user's instructions", () => {
    expect(buildCodexCompactPrompt("focus on the auth bug")).toContain("focus on the auth bug")
  })
})
