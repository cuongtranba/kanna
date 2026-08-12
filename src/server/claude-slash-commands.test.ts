/**
 * Tests for claude-slash-commands.ts
 *
 * The `/` picker is populated from Kanna's own builtins plus the local disk
 * catalog — the Claude CLI is never consulted and no session is spawned. All
 * IO is injected via the deps.
 */

import { describe, test, expect } from "bun:test"
import { localCommandsForCwd, type SlashCommandsDeps } from "./claude-slash-commands"
import { BUILTIN_SLASH_COMMANDS } from "../shared/builtin-commands"
import type { SlashCommand, SlashCommandScope } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BUILTIN_NAMES = BUILTIN_SLASH_COMMANDS.map((c) => c.name)

function makeSlashCommand(name: string, scope: SlashCommandScope = "project"): SlashCommand {
  return { name, description: "", argumentHint: "", kind: "skill", scope }
}

function makeDeps(overrides: Partial<SlashCommandsDeps> = {}): SlashCommandsDeps {
  return { localCatalog: null, ...overrides }
}

// ---------------------------------------------------------------------------
// localCommandsForCwd
// ---------------------------------------------------------------------------

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
})
