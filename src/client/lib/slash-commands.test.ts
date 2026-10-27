import { describe, expect, test } from "vite-plus/test"
import { filterCommands } from "./slash-commands"
import type { SlashCommand } from "../../shared/types"

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
    expect(filterCommands(list, "deploy").map((c) => c.name)).toEqual(["deploy-now", "run-deploy"])
  })
})

