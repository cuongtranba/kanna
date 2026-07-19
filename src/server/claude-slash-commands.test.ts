/**
 * Tests for claude-slash-commands.ts
 *
 * Covers the extracted ensureSlashCommandsLoaded and mergeLocalCatalog helpers.
 * All IO is injected through the deps interface; no real sessions are spawned.
 */

import { describe, test, expect } from "bun:test"
import { ensureSlashCommandsLoaded, mergeLocalCatalog, type SlashCommandsDeps } from "./claude-slash-commands"
import type { SlashCommand } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSlashCommand(name: string, description = ""): SlashCommand {
  return { name, description, argumentHint: "" }
}

function makeDeps(overrides: Partial<SlashCommandsDeps> = {}): SlashCommandsDeps {
  return {
    store: {
      getChat: () => ({
        provider: "claude" as const,
        slashCommands: null,
        planMode: false,
        projectId: "proj-1",
        sessionTokensByProvider: { claude: null },
      }),
      getProject: () => ({ id: "proj-1", localPath: "/tmp/proj" }),
      recordSessionCommandsLoaded: async () => undefined,
    },
    claudeSessions: { get: () => undefined },
    oauthPool: null,
    slashCommandsInFlight: new Set<string>(),
    emitStateChange: () => undefined,
    resolveClaudeDriverPreference: () => "sdk",
    startClaudeSessionPTY: async () => {
      throw new Error("PTY not expected in these tests")
    },
    startClaudeSessionSDK: async () => {
      throw new Error("SDK session not expected in these tests")
    },
    getSubagents: () => [],
    getGlobalPromptAppend: () => undefined,
    getEnabledCustomMcpServers: () => [],
    claudePtyRegistry: null,
    ptyInstanceRegistry: null,
    workflowRegistry: null,
    subagentTranscriptRegistry: null,
    localCatalog: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// mergeLocalCatalog
// ---------------------------------------------------------------------------

describe("mergeLocalCatalog", () => {
  test("returns commands unchanged when localCatalog is null", () => {
    const commands = [makeSlashCommand("foo"), makeSlashCommand("bar")]
    const deps = makeDeps({ localCatalog: null })
    const result = mergeLocalCatalog(deps, commands, "/cwd")
    expect(result).toEqual(commands)
  })

  test("appends local commands that do not conflict with CLI commands", () => {
    const cliCommands = [makeSlashCommand("help")]
    const localCommands = [makeSlashCommand("mylocal")]
    const deps = makeDeps({
      localCatalog: { list: () => localCommands },
    })
    const result = mergeLocalCatalog(deps, cliCommands, "/cwd")
    expect(result).toHaveLength(2)
    expect(result[0]?.name).toBe("help")
    expect(result[1]?.name).toBe("mylocal")
  })

  test("filters out local commands that duplicate CLI commands (case-insensitive)", () => {
    const cliCommands = [makeSlashCommand("Help")]
    const localCommands = [makeSlashCommand("help"), makeSlashCommand("custom")]
    const deps = makeDeps({
      localCatalog: { list: () => localCommands },
    })
    const result = mergeLocalCatalog(deps, cliCommands, "/cwd")
    expect(result).toHaveLength(2)
    expect(result.map((c) => c.name)).toEqual(["Help", "custom"])
  })

  test("returns commands unchanged when localCatalog.list throws", () => {
    const cliCommands = [makeSlashCommand("foo")]
    const deps = makeDeps({
      localCatalog: {
        list: () => {
          throw new Error("scan failed")
        },
      },
    })
    const result = mergeLocalCatalog(deps, cliCommands, "/cwd")
    expect(result).toEqual(cliCommands)
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
        getChat: () => ({
          provider: "codex" as const,
          slashCommands: null,
          planMode: false,
          projectId: "proj-1",
          sessionTokensByProvider: {},
        }),
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
          slashCommands: [makeSlashCommand("help")],
          planMode: false,
          projectId: "proj-1",
          sessionTokensByProvider: { claude: null },
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

  test("loads commands from existing session and persists them", async () => {
    const commands = [makeSlashCommand("clear"), makeSlashCommand("help")]
    let recorded: SlashCommand[] = []
    const deps = makeDeps({
      claudeSessions: {
        get: () => ({
          session: { getSupportedCommands: async () => commands },
        }),
      },
      store: {
        getChat: () => ({
          provider: "claude" as const,
          slashCommands: null,
          planMode: false,
          projectId: "proj-1",
          sessionTokensByProvider: { claude: null },
        }),
        getProject: () => ({ id: "proj-1", localPath: "/tmp/proj" }),
        recordSessionCommandsLoaded: async (_chatId, cmds) => {
          recorded = cmds
        },
      },
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(recorded).toEqual(commands)
    expect(deps.slashCommandsInFlight.has("chat-1")).toBe(false)
  })

  test("clears in-flight flag when getSupportedCommands hangs (timeout guard)", async () => {
    const neverResolves = new Promise<SlashCommand[]>(() => {})
    const deps = makeDeps({
      timeoutMs: 20,
      claudeSessions: {
        get: () => ({
          session: { getSupportedCommands: () => neverResolves },
        }),
      },
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(deps.slashCommandsInFlight.has("chat-1")).toBe(false)
  }, 5_000)

  test("clears in-flight flag when ephemeral spawn hangs (timeout guard)", async () => {
    const neverResolves = new Promise<never>(() => {})
    const deps = makeDeps({
      timeoutMs: 20,
      startClaudeSessionSDK: () => neverResolves,
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(deps.slashCommandsInFlight.has("chat-1")).toBe(false)
  }, 5_000)

  test("clears in-flight flag on error from existing session", async () => {
    const deps = makeDeps({
      claudeSessions: {
        get: () => ({
          session: {
            getSupportedCommands: async () => {
              throw new Error("session died")
            },
          },
        }),
      },
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(deps.slashCommandsInFlight.has("chat-1")).toBe(false)
  })

  test("spawns ephemeral SDK session when no active session and no oauthPool", async () => {
    const cliCommands = [makeSlashCommand("help")]
    const closed = { value: false }
    let recorded: SlashCommand[] = []
    const noopAsync = async () => undefined
    const deps = makeDeps({
      startClaudeSessionSDK: async () => ({
        provider: "claude" as const,
        stream: (async function* () {})(),
        interrupt: noopAsync,
        close: () => { closed.value = true },
        sendPrompt: noopAsync,
        setModel: noopAsync,
        setPermissionMode: noopAsync,
        getSupportedCommands: async () => cliCommands,
      }),
      store: {
        getChat: () => ({
          provider: "claude" as const,
          slashCommands: null,
          planMode: false,
          projectId: "proj-1",
          sessionTokensByProvider: { claude: null },
        }),
        getProject: () => ({ id: "proj-1", localPath: "/tmp/proj" }),
        recordSessionCommandsLoaded: async (_chatId, cmds) => {
          recorded = cmds
        },
      },
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(closed.value).toBe(true)
    expect(recorded).toEqual(cliCommands)
    expect(deps.slashCommandsInFlight.has("chat-1")).toBe(false)
  })

  test("merges local catalog commands into loaded commands", async () => {
    const cliCommands = [makeSlashCommand("help")]
    const localCommands = [makeSlashCommand("mylocal")]
    let recorded: SlashCommand[] = []
    const deps = makeDeps({
      claudeSessions: {
        get: () => ({
          session: { getSupportedCommands: async () => cliCommands },
        }),
      },
      localCatalog: { list: () => localCommands },
      store: {
        getChat: () => ({
          provider: "claude" as const,
          slashCommands: null,
          planMode: false,
          projectId: "proj-1",
          sessionTokensByProvider: { claude: null },
        }),
        getProject: () => ({ id: "proj-1", localPath: "/tmp/proj" }),
        recordSessionCommandsLoaded: async (_chatId, cmds) => {
          recorded = cmds
        },
      },
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(recorded).toHaveLength(2)
    expect(recorded.map((c) => c.name)).toEqual(["help", "mylocal"])
  })

  test("skips ephemeral spawn when oauthPool has tokens but pickEphemeral returns null", async () => {
    const deps = makeDeps({
      oauthPool: {
        pickEphemeral: () => null,
        hasAnyToken: () => true,
        markUsed: () => undefined,
      },
      startClaudeSessionSDK: async () => {
        throw new Error("should not be called")
      },
    })
    await expect(ensureSlashCommandsLoaded(deps, "chat-1")).resolves.toBeUndefined()
    expect(deps.slashCommandsInFlight.has("chat-1")).toBe(false)
  })

  test("reuses cached CLI commands and skips the ephemeral spawn", async () => {
    const cached = [makeSlashCommand("help"), makeSlashCommand("clear")]
    let recorded: SlashCommand[] = []
    let spawnCalled = false
    const deps = makeDeps({
      cliCommandCache: {
        get: (cwd) => (cwd === "/tmp/proj" ? cached : null),
        set: () => undefined,
      },
      startClaudeSessionSDK: async () => {
        spawnCalled = true
        throw new Error("ephemeral spawn must NOT run on a cache hit")
      },
      store: {
        getChat: () => ({
          provider: "claude" as const,
          slashCommands: null,
          planMode: false,
          projectId: "proj-1",
          sessionTokensByProvider: { claude: null },
        }),
        getProject: () => ({ id: "proj-1", localPath: "/tmp/proj" }),
        recordSessionCommandsLoaded: async (_chatId, cmds) => {
          recorded = cmds
        },
      },
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(spawnCalled).toBe(false)
    expect(recorded.map((c) => c.name)).toEqual(["help", "clear"])
    expect(deps.slashCommandsInFlight.has("chat-1")).toBe(false)
  })

  test("populates the cache after an ephemeral spawn (raw CLI commands)", async () => {
    const cliCommands = [makeSlashCommand("help")]
    const cacheSets: Array<{ cwd: string; commands: SlashCommand[] }> = []
    const noopAsync = async () => undefined
    const deps = makeDeps({
      cliCommandCache: {
        get: () => null,
        set: (cwd, commands) => { cacheSets.push({ cwd, commands }) },
      },
      localCatalog: { list: () => [makeSlashCommand("mylocal")] },
      startClaudeSessionSDK: async () => ({
        provider: "claude" as const,
        stream: (async function* () {})(),
        interrupt: noopAsync,
        close: () => undefined,
        sendPrompt: noopAsync,
        setModel: noopAsync,
        setPermissionMode: noopAsync,
        getSupportedCommands: async () => cliCommands,
      }),
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(cacheSets).toHaveLength(1)
    expect(cacheSets[0]?.cwd).toBe("/tmp/proj")
    // Cache holds RAW CLI commands, not the local-catalog merge.
    expect(cacheSets[0]?.commands.map((c) => c.name)).toEqual(["help"])
  })

  test("populates the cache from an existing session's commands", async () => {
    const cliCommands = [makeSlashCommand("clear")]
    const cacheSets: Array<{ cwd: string; commands: SlashCommand[] }> = []
    const deps = makeDeps({
      cliCommandCache: {
        get: () => null,
        set: (cwd, commands) => { cacheSets.push({ cwd, commands }) },
      },
      claudeSessions: {
        get: () => ({ session: { getSupportedCommands: async () => cliCommands } }),
      },
    })
    await ensureSlashCommandsLoaded(deps, "chat-1")
    expect(cacheSets).toHaveLength(1)
    expect(cacheSets[0]?.commands.map((c) => c.name)).toEqual(["clear"])
  })
})
