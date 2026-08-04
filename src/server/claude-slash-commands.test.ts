/**
 * Tests for claude-slash-commands.ts
 *
 * The `/` picker is populated exclusively from the local disk catalog — the
 * Claude CLI is never consulted and no session is spawned. All IO is injected
 * via the deps.
 */

import { describe, test, expect } from "bun:test"
import { localCommandsForCwd, type SlashCommandsDeps } from "./claude-slash-commands"
import type { SlashCommand, SlashCommandScope } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  test("returns [] when localCatalog is null", () => {
    expect(localCommandsForCwd(makeDeps({ localCatalog: null }), "/cwd")).toEqual([])
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
    expect(result.map((c) => c.name)).toEqual(["proj-skill", "user-skill", "cloudflare:sandbox"])
  })

  test("returns [] when localCatalog.list throws", () => {
    const deps = makeDeps({
      localCatalog: {
        list: () => {
          throw new Error("scan failed")
        },
      },
    })
    expect(localCommandsForCwd(deps, "/cwd")).toEqual([])
  })
})
