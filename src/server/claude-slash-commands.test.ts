
import { describe, test, expect } from "vite-plus/test"
import { localCommandsForCwd, type SlashCommandsDeps } from "./claude-slash-commands"
import { BUILTIN_SLASH_COMMANDS } from "../shared/builtin-commands"
import { openClaudeCliCommands } from "./claude-cli-commands"
import type { SlashCommand, SlashCommandScope } from "../shared/types"


const BUILTIN_NAMES = BUILTIN_SLASH_COMMANDS.map((c) => c.name)

function makeSlashCommand(name: string, scope: SlashCommandScope = "project"): SlashCommand {
  return { name, description: "", argumentHint: "", kind: "skill", scope }
}

function makeDeps(overrides: Partial<SlashCommandsDeps> = {}): SlashCommandsDeps {
  return { localCatalog: null, ...overrides }
}


describe("localCommandsForCwd", () => {
  test("returns the builtins when localCatalog is null", () => {
    expect(localCommandsForCwd(makeDeps({ localCatalog: null }), "/cwd")).toEqual([
      ...BUILTIN_SLASH_COMMANDS,
    ])
  })

  test("surfaces every locally invocable scope, including plugins", () => {
    const deps = makeDeps({
      localCatalog: {
        list: () => [
          makeSlashCommand("proj-skill", "project"),
          makeSlashCommand("user-skill", "personal"),
          makeSlashCommand("cloudflare:sandbox", "plugin"),
        ],
      },
    })
    const result = localCommandsForCwd(deps, "/cwd")
    expect(result.map((c) => c.name)).toEqual([
      ...BUILTIN_NAMES,
      "proj-skill",
      "user-skill",
      "cloudflare:sandbox",
    ])
  })

  test("a scan failure degrades to the builtins rather than an empty picker", () => {
    const deps = makeDeps({
      localCatalog: {
        list: () => {
          throw new Error("scan failed")
        },
      },
    })
    expect(localCommandsForCwd(deps, "/cwd")).toEqual([...BUILTIN_SLASH_COMMANDS])
  })

  test("a disk command sharing a builtin name is not listed twice", () => {
    const deps = makeDeps({
      localCatalog: { list: () => [makeSlashCommand("clear", "project")] },
    })
    const names = localCommandsForCwd(deps, "/cwd").map((c) => c.name)
    expect(names.filter((n) => n === "clear")).toHaveLength(1)
  })

  test("builtins are listed first so the picker offers them without typing", () => {
    const deps = makeDeps({
      localCatalog: { list: () => [makeSlashCommand("aaa-first-alphabetically", "project")] },
    })
    const result = localCommandsForCwd(deps, "/cwd")
    expect(result.slice(0, BUILTIN_NAMES.length).map((c) => c.name)).toEqual(BUILTIN_NAMES)
  })

  test("lists only Claude Code's own commands recorded from SDK rows, after Kanna's builtins and ahead of disk skills", async () => {
    const cliCommands = await openClaudeCliCommands({ load: async () => [], save: async () => {} })
    cliCommands.record([
      { name: "doctor", description: "Diagnose", argumentHint: "", builtin: true },
      { name: "clear", description: "SDK clear", argumentHint: "", builtin: true },
      { name: "__remote-workflow", description: "internal", argumentHint: "", builtin: true },
      { name: "my-skill", description: "user skill", argumentHint: "" },
    ])
    const deps = makeDeps({
      cliCommands,
      localCatalog: { list: () => [makeSlashCommand("doctor", "project"), makeSlashCommand("my-skill", "personal")] },
    })
    const result = localCommandsForCwd(deps, "/cwd")
    expect(result.map((c) => c.name)).toEqual([...BUILTIN_NAMES, "doctor", "doctor", "my-skill"])
    expect(result.find((c) => c.name === "doctor")?.scope).toBe("cli")
  })
})
