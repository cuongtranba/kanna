/**
 * Tests for claude-slash-commands.ts
 *
 * The `/` picker is populated exclusively from the local disk catalog
 * (project + personal scopes); plugin-scope entries and the Claude CLI are
 * NOT consulted. No sessions are spawned. All IO is injected via the deps.
 */

import { describe, test, expect } from "bun:test"
import { ensureSlashCommandsLoaded, localCommandsForCwd, type SlashCommandsDeps } from "./claude-slash-commands"
import type { SlashCommand, SlashCommandScope } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSlashCommand(name: string, scope: SlashCommandScope = "project"): SlashCommand {
  return { name, description: "", argumentHint: "", kind: "skill", scope }
}

function makeDeps(overrides: Partial<SlashCommandsDeps> = {}): SlashCommandsDeps {
  return {
    store: {
      getChat: () => ({
        provider: "claude" as const,
        slashCommands: null,
        projectId: "proj-1",
      }),
      getProject: () => ({ id: "proj-1", localPath: "/tmp/proj" }),
      recordSessionCommandsLoaded: async () => undefined,
    },
    slashCommandsInFlight: new Set<string>(),
    emitStateChange: () => undefined,
    localCatalog: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// localCommandsForCwd
// ---------------------------------------------------------------------------

describe("localCommandsForCwd", () => {
  test("returns [] when localCatalog is null", () => {
    expect(localCommandsForCwd(makeDeps({ localCatalog: null }), "/cwd")).toEqual([])
  })

  test("keeps project + personal scopes, drops plugin + builtin", () => {
    const deps = makeDeps({
      localCatalog: {
        list: () => [
          makeSlashCommand("proj-skill", "project"),
          makeSlashCommand("user-skill", "personal"),
          makeSlashCommand("cloudflare:sandbox", "plugin"),
          makeSlashCommand("help", "builtin"),
        ],
      },
    })
    const result = localCommandsForCwd(deps, "/cwd")
    expect(result.map((c) => c.name)).toEqual(["proj-skill", "user-skill"])
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

// ---------------------------------------------------------------------------
// ensureSlashCommandsLoaded
// ---------------------------------------------------------------------------

describe("ensureSlashCommandsLoaded", () => {
  test("returns early when chat is not found", async () => {
    const deps = makeDeps({ store: { ...makeDeps().store, getChat: () => null } })
    await expect(ensureSlashCommandsLoaded(deps, "chat-1")).resolves.toBeUndefined()
  })

  test("returns early for codex provider", async () => {
    const deps = makeDeps({
      store: {
        ...makeDeps().store,
        getChat: () => ({ provider: "codex" as const, slashCommands: null, projectId: "proj-1" }),
      },
    })
    await expect(ensureSlashCommandsLoaded(deps, "chat-1")).resolves.toBeUndefined()
  })

  test("returns early when slash commands are already loaded", async () => {
    const deps = makeDeps({
      store: {
        ...makeDeps().store,
        getChat: () => ({
          provider: "claude" as const,
          slashCommands: [makeSlashCommand("proj-skill")],
          projectId: "proj-1",
        }),
      },
    })
    await expect(ensureSlashCommandsLoaded(deps, "chat-1")).resolves.toBeUndefined()
  })

  test("returns early when load is already in-flight", async () => {
    const inFlight = new Set(["chat-1"])
    const deps = makeDeps({ slashCommandsInFlight: inFlight })
    await expect(ensureSlashCommandsLoaded(deps, "chat-1")).resolves.toBeUndefined()
  })

  test("loads local project + personal commands and persists them; clears in-flight", async () => {
    let recorded: SlashCommand[] = []
    const deps = makeDeps({
      localCatalog: {
        list: () => [
          makeSlashCommand("proj-skill", "project"),
          makeSlashCommand("user-skill", "personal"),
          makeSlashCommand("cloudflare:sandbox", "plugin"),
        ],
      },
      store: {
        getChat: () => ({ provider: "claude" as const, slashCommands: null, projectId: "proj-1" }),
        getProject: () => ({ id: "proj-1", localPath: "/tmp/proj" }),
        recordSessionCommandsLoaded: async (_chatId, cmds) => {
          recorded = cmds
        },
      },
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(recorded.map((c) => c.name)).toEqual(["proj-skill", "user-skill"])
    expect(deps.slashCommandsInFlight.has("chat-1")).toBe(false)
  })

  test("records an empty list when the local catalog is empty; clears in-flight", async () => {
    let recordCalls = 0
    let recorded: SlashCommand[] = [makeSlashCommand("__unset__")]
    const deps = makeDeps({
      localCatalog: { list: () => [] },
      store: {
        getChat: () => ({ provider: "claude" as const, slashCommands: null, projectId: "proj-1" }),
        getProject: () => ({ id: "proj-1", localPath: "/tmp/proj" }),
        recordSessionCommandsLoaded: async (_chatId, cmds) => {
          recordCalls += 1
          recorded = cmds
        },
      },
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(recordCalls).toBe(1)
    expect(recorded).toEqual([])
    expect(deps.slashCommandsInFlight.has("chat-1")).toBe(false)
  })

  test("clears in-flight flag when recordSessionCommandsLoaded throws", async () => {
    const deps = makeDeps({
      localCatalog: { list: () => [makeSlashCommand("proj-skill")] },
      store: {
        getChat: () => ({ provider: "claude" as const, slashCommands: null, projectId: "proj-1" }),
        getProject: () => ({ id: "proj-1", localPath: "/tmp/proj" }),
        recordSessionCommandsLoaded: async () => {
          throw new Error("write failed")
        },
      },
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(deps.slashCommandsInFlight.has("chat-1")).toBe(false)
  })

  test("returns early when project is not found", async () => {
    const deps = makeDeps({
      store: { ...makeDeps().store, getProject: () => null },
    })
    await expect(ensureSlashCommandsLoaded(deps, "chat-1")).resolves.toBeUndefined()
    expect(deps.slashCommandsInFlight.has("chat-1")).toBe(false)
  })
})
