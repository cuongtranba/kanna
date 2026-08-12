import { describe, expect, test, test as it } from "bun:test"
import { applyCommandToInput, shouldShowPicker, filterCommands, commandsForProvider } from "./slash-commands"
import type { SlashCommand } from "../../shared/types"

describe("shouldShowPicker", () => {
  test("opens when value starts with / and caret inside token", () => {
    expect(shouldShowPicker("/rev", 4)).toEqual({ open: true, query: "rev" })
  })

  test("opens on bare slash with caret after it", () => {
    expect(shouldShowPicker("/", 1)).toEqual({ open: true, query: "" })
  })

  test("closes after space", () => {
    expect(shouldShowPicker("/review ", 8)).toEqual({ open: false, query: "" })
  })

  test("closes after newline", () => {
    expect(shouldShowPicker("/review\n", 8)).toEqual({ open: false, query: "" })
  })

  test("closes when caret before slash", () => {
    expect(shouldShowPicker("/rev", 0)).toEqual({ open: false, query: "" })
  })

  test("closes when first char not slash", () => {
    expect(shouldShowPicker("hi /rev", 7)).toEqual({ open: false, query: "" })
  })

  test("closes for empty value", () => {
    expect(shouldShowPicker("", 0)).toEqual({ open: false, query: "" })
  })

  test("closes when caret beyond first token", () => {
    expect(shouldShowPicker("/review arg", 11)).toEqual({ open: false, query: "" })
  })
})

describe("filterCommands", () => {
  const all: SlashCommand[] = [
    { name: "review", description: "r", argumentHint: "" },
    { name: "reset", description: "s", argumentHint: "" },
    { name: "init", description: "i", argumentHint: "" },
  ]

  test("empty query returns all sorted alphabetical", () => {
    expect(filterCommands(all, "").map((c) => c.name)).toEqual(["init", "reset", "review"])
  })

  test("prefix matches rank before substring", () => {
    const list: SlashCommand[] = [
      { name: "unreview", description: "", argumentHint: "" },
      { name: "review", description: "", argumentHint: "" },
    ]
    expect(filterCommands(list, "rev").map((c) => c.name)).toEqual(["review", "unreview"])
  })

  test("case-insensitive", () => {
    expect(filterCommands(all, "REV").map((c) => c.name)).toEqual(["review"])
  })

  test("no matches returns empty array", () => {
    expect(filterCommands(all, "xyz")).toEqual([])
  })

  test("same-tier alphabetical tiebreak", () => {
    const list: SlashCommand[] = [
      { name: "revz", description: "", argumentHint: "" },
      { name: "revb", description: "", argumentHint: "" },
      { name: "reva", description: "", argumentHint: "" },
    ]
    expect(filterCommands(list, "rev").map((c) => c.name)).toEqual(["reva", "revb", "revz"])
  })

  test("does not match on description or argumentHint", () => {
    const list: SlashCommand[] = [
      { name: "help", description: "review this", argumentHint: "<pr>" },
    ]
    expect(filterCommands(list, "review")).toEqual([])
  })

  // Plugin scope is the bulk of the catalog, so the skills the user wrote
  // themselves must not be pushed below a wall of `plugin:name` entries.
  test("your own skills rank above plugin skills within a match tier", () => {
    const list: SlashCommand[] = [
      { name: "aaa:deploy", description: "", argumentHint: "", scope: "plugin" },
      { name: "zzz-deploy", description: "", argumentHint: "", scope: "personal" },
      { name: "mmm-deploy", description: "", argumentHint: "", scope: "project" },
    ]
    expect(filterCommands(list, "").map((c) => c.name)).toEqual([
      "mmm-deploy",
      "zzz-deploy",
      "aaa:deploy",
    ])
  })

  test("scope rank never outranks match tier", () => {
    const list: SlashCommand[] = [
      { name: "deploy-now", description: "", argumentHint: "", scope: "plugin" },
      { name: "run-deploy", description: "", argumentHint: "", scope: "personal" },
    ]
    // A personal substring match still loses to a plugin prefix match.
    expect(filterCommands(list, "deploy").map((c) => c.name)).toEqual(["deploy-now", "run-deploy"])
  })
})

describe("applyCommandToInput", () => {
  test("replaces the /token at caret with /name and trailing space when argumentHint present", () => {
    const result = applyCommandToInput({
      value: "/rev",
      caret: 4,
      command: { name: "review", description: "", argumentHint: "<pr>" },
    })
    expect(result).toEqual({ value: "/review ", caret: 8 })
  })

  test("omits trailing space when argumentHint is empty", () => {
    const result = applyCommandToInput({
      value: "/hel",
      caret: 4,
      command: { name: "help", description: "", argumentHint: "" },
    })
    expect(result).toEqual({ value: "/help", caret: 5 })
  })

  test("leaves input unchanged if caret is not inside a slash token", () => {
    const result = applyCommandToInput({
      value: "hello",
      caret: 5,
      command: { name: "review", description: "", argumentHint: "" },
    })
    expect(result).toEqual({ value: "hello", caret: 5 })
  })

  test("preserves content after caret", () => {
    const result = applyCommandToInput({
      value: "/rev rest",
      caret: 4,
      command: { name: "review", description: "", argumentHint: "" },
    })
    // This input is "/rev" + " rest"; caret at 4 means we replace "/rev"
    expect(result).toEqual({ value: "/review rest", caret: 7 })
  })
})

describe("commandsForProvider", () => {
  const builtin: SlashCommand = { name: "clear", description: "", argumentHint: "", scope: "builtin" }
  const projectSkill: SlashCommand = { name: "review-pr", description: "", argumentHint: "", scope: "project" }
  const pluginSkill: SlashCommand = { name: "cf:sandbox", description: "", argumentHint: "", scope: "plugin" }
  const all = [builtin, projectSkill, pluginSkill]

  it("returns everything for claude", () => {
    expect(commandsForProvider(all, "claude")).toEqual(all)
  })

  it("returns everything for openrouter — same claude CLI underneath", () => {
    expect(commandsForProvider(all, "openrouter")).toEqual(all)
  })

  it("returns only builtins for codex — disk skills are Claude Code skills", () => {
    expect(commandsForProvider(all, "codex")).toEqual([builtin])
  })

  it("returns a stable reference when nothing is filtered out", () => {
    expect(commandsForProvider(all, "claude")).toBe(all)
  })
})

describe("builtin scope ranking", () => {
  it("sorts builtins below user-authored commands and above plugin ones", () => {
    const list: SlashCommand[] = [
      { name: "zzz-plugin", description: "", argumentHint: "", scope: "plugin" },
      { name: "clear", description: "", argumentHint: "", scope: "builtin" },
      { name: "zzz-project", description: "", argumentHint: "", scope: "project" },
    ]
    expect(filterCommands(list, "").map((c) => c.name)).toEqual([
      "zzz-project",
      "clear",
      "zzz-plugin",
    ])
  })
})
