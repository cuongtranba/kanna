import { describe, expect, test } from "bun:test"
import {
  buildFallbackDiffStore,
  buildFallbackLlmProvider,
  buildInitialAppSettingsSnapshot,
  buildResolvedAppSettings,
  mergeAppSettingsPatch,
} from "./ws-router-defaults"
import type { AppSettingsSnapshot, SubagentInput } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(): AppSettingsSnapshot {
  return buildInitialAppSettingsSnapshot()
}

const BASE_SUBAGENT_INPUT: SubagentInput = {
  name: "Bot",
  description: "",
  provider: "claude",
  model: "claude-opus-4-7",
  systemPrompt: "",
  modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
  contextScope: "full-transcript",
}

// ---------------------------------------------------------------------------
// mergeAppSettingsPatch
// ---------------------------------------------------------------------------

describe("mergeAppSettingsPatch", () => {
  test("subagents.create appends a new subagent with generated id and trims name", () => {
    const snapshot = makeSnapshot()
    const result = mergeAppSettingsPatch(snapshot, {
      subagents: {
        create: { ...BASE_SUBAGENT_INPUT, name: "  My Bot  ", triggerMode: "manual" },
      },
    })
    expect(result.subagents).toHaveLength(1)
    const s = result.subagents[0]
    expect(s).toBeDefined()
    if (!s) return
    expect(s.name).toBe("My Bot") // trimmed
    expect(s.triggerMode).toBe("manual")
    expect(typeof s.id).toBe("string")
    expect(s.id.length).toBeGreaterThan(0)
  })

  test("subagents.create defaults triggerMode to 'auto' when omitted", () => {
    const snapshot = makeSnapshot()
    const result = mergeAppSettingsPatch(snapshot, {
      subagents: { create: BASE_SUBAGENT_INPUT },
    })
    expect(result.subagents[0]?.triggerMode).toBe("auto")
  })

  test("subagents.update patches matching subagent name", () => {
    const withSubagent = mergeAppSettingsPatch(makeSnapshot(), {
      subagents: { create: BASE_SUBAGENT_INPUT },
    })
    const id = withSubagent.subagents[0]!.id
    const updated = mergeAppSettingsPatch(withSubagent, {
      subagents: { update: { id, patch: { name: "New Name" } } },
    })
    expect(updated.subagents[0]?.name).toBe("New Name")
  })

  test("subagents.delete removes the matching subagent", () => {
    const withSubagent = mergeAppSettingsPatch(makeSnapshot(), {
      subagents: { create: BASE_SUBAGENT_INPUT },
    })
    const id = withSubagent.subagents[0]!.id
    const result = mergeAppSettingsPatch(withSubagent, { subagents: { delete: { id } } })
    expect(result.subagents).toHaveLength(0)
  })

  test("terminal and editor are deep-merged (unset fields preserved)", () => {
    const snapshot = makeSnapshot()
    const result = mergeAppSettingsPatch(snapshot, {
      terminal: { scrollbackLines: 2_000 },
      editor: { preset: "vscode" },
    })
    expect(result.terminal.scrollbackLines).toBe(2_000)
    expect(result.terminal.minColumnWidth).toBe(450) // preserved from base
    expect(result.editor.preset).toBe("vscode")
    expect(result.editor.commandTemplate).toBe("cursor {path}") // preserved from base
  })

  test("providerDefaults.claude modelOptions are deep-merged", () => {
    const snapshot = makeSnapshot()
    const result = mergeAppSettingsPatch(snapshot, {
      providerDefaults: {
        claude: { modelOptions: { reasoningEffort: "low", contextWindow: "200k" } },
      },
    })
    expect(result.providerDefaults.claude.modelOptions.reasoningEffort).toBe("low")
    // contextWindow preserved since we included it in the patch
    expect(result.providerDefaults.claude.modelOptions.contextWindow).toBe("200k")
    // unrelated provider unchanged
    expect(result.providerDefaults.codex.modelOptions.reasoningEffort).toBe("high")
  })

  test("claudeDriver lifecycle is deep-merged and preference is preserved", () => {
    const snapshot = makeSnapshot()
    const result = mergeAppSettingsPatch(snapshot, {
      claudeDriver: { lifecycle: { idleTimeoutMs: 9_000 } },
    })
    expect(result.claudeDriver.preference).toBe(snapshot.claudeDriver.preference)
    expect(result.claudeDriver.lifecycle).toMatchObject({ idleTimeoutMs: 9_000 })
  })

  test("subagentRuntime.defaultLoopSubagentId null clears the value", () => {
    const snapshot = {
      ...makeSnapshot(),
      subagentRuntime: { runTimeoutMs: 600_000, defaultLoopSubagentId: "abc" },
    }
    const result = mergeAppSettingsPatch(snapshot, {
      subagentRuntime: { defaultLoopSubagentId: null },
    })
    expect(result.subagentRuntime.defaultLoopSubagentId).toBeNull()
  })

  test("returns a new snapshot object (does not mutate input)", () => {
    const snapshot = makeSnapshot()
    const result = mergeAppSettingsPatch(snapshot, { analyticsEnabled: false })
    expect(result).not.toBe(snapshot)
    expect(snapshot.analyticsEnabled).toBe(true) // original unchanged
    expect(result.analyticsEnabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildFallbackDiffStore
// ---------------------------------------------------------------------------

describe("buildFallbackDiffStore", () => {
  test("returns an object with all required DiffStore methods", () => {
    const store = buildFallbackDiffStore()
    const methods = [
      "getProjectSnapshot", "refreshSnapshot", "initializeGit",
      "getGitHubPublishInfo", "checkGitHubRepoAvailability", "publishToGitHub",
      "listBranches", "previewMergeBranch", "mergeBranch", "syncBranch",
      "checkoutBranch", "createBranch", "generateCommitMessage", "commitFiles",
      "discardFile", "ignoreFile", "readPatch",
    ] as const
    for (const m of methods) {
      expect(typeof store[m]).toBe("function")
    }
  })

  test("getProjectSnapshot returns an unknown status with empty files", () => {
    const store = buildFallbackDiffStore()
    const snap = store.getProjectSnapshot("any-project-id")
    expect(snap.status).toBe("unknown")
    expect(snap.files).toEqual([])
  })

  test("listBranches resolves with empty arrays and unavailable pullRequestsStatus", async () => {
    const result = await buildFallbackDiffStore().listBranches()
    expect(result.recent).toEqual([])
    expect(result.pullRequestsStatus).toBe("unavailable")
  })

  test("readPatch resolves with empty patch string", async () => {
    const result = await buildFallbackDiffStore().readPatch()
    expect(result.patch).toBe("")
  })
})

// ---------------------------------------------------------------------------
// buildFallbackLlmProvider
// ---------------------------------------------------------------------------

describe("buildFallbackLlmProvider", () => {
  test("returns an object with read, write, validate methods", () => {
    const provider = buildFallbackLlmProvider()
    expect(typeof provider.read).toBe("function")
    expect(typeof provider.write).toBe("function")
    expect(typeof provider.validate).toBe("function")
  })

  test("read resolves with disabled openai shape", async () => {
    const snap = await buildFallbackLlmProvider().read()
    expect(snap.provider).toBe("openai")
    expect(snap.enabled).toBe(false)
    expect(snap.resolvedBaseUrl).toBe("https://api.openai.com/v1")
  })

  test("write computes resolvedBaseUrl for openrouter", async () => {
    const snap = await buildFallbackLlmProvider().write({
      provider: "openrouter",
      apiKey: "k",
      model: "m",
      baseUrl: "",
    })
    expect(snap.resolvedBaseUrl).toBe("https://openrouter.ai/api/v1")
  })

  test("write uses custom baseUrl for 'custom' provider", async () => {
    const snap = await buildFallbackLlmProvider().write({
      provider: "custom",
      apiKey: "",
      model: "m",
      baseUrl: "https://my-endpoint.example.com/v1",
    })
    expect(snap.resolvedBaseUrl).toBe("https://my-endpoint.example.com/v1")
  })

  test("validate always returns ok:false", async () => {
    const result = await buildFallbackLlmProvider().validate({
      provider: "openai",
      apiKey: "k",
      model: "m",
      baseUrl: "",
    })
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildResolvedAppSettings
// ---------------------------------------------------------------------------

describe("buildResolvedAppSettings", () => {
  test("getSnapshot returns built-in fallback when no appSettings provided", () => {
    const resolved = buildResolvedAppSettings(undefined)
    const snap = resolved.getSnapshot()
    expect(snap.analyticsEnabled).toBe(true)
    expect(snap.subagents).toEqual([])
    expect(snap.customMcpServers).toEqual([])
  })

  test("writePatch mutates the in-memory fallback when no appSettings", async () => {
    const resolved = buildResolvedAppSettings(undefined)
    expect(resolved.getSnapshot().analyticsEnabled).toBe(true)
    const after = await resolved.writePatch({ analyticsEnabled: false })
    expect(after.analyticsEnabled).toBe(false)
    // getSnapshot reflects the mutation
    expect(resolved.getSnapshot().analyticsEnabled).toBe(false)
  })

  test("onChange returns callable noop when no appSettings", () => {
    const resolved = buildResolvedAppSettings(undefined)
    const dispose = resolved.onChange(() => {})
    expect(typeof dispose).toBe("function")
    expect(() => dispose()).not.toThrow()
  })

  test("getSnapshot delegates to real appSettings when provided", () => {
    const mockSnapshot = { ...makeSnapshot(), analyticsEnabled: false }
    const fakeManager = { getSnapshot: () => mockSnapshot, write: async () => mockSnapshot }
    const resolved = buildResolvedAppSettings(fakeManager)
    expect(resolved.getSnapshot().analyticsEnabled).toBe(false)
  })

  test("createSubagent falls back to writePatch when manager lacks createSubagent", async () => {
    const resolved = buildResolvedAppSettings(undefined)
    const result = await resolved.createSubagent({ ...BASE_SUBAGENT_INPUT, name: "FallbackBot" })
    // Should be the newly created subagent, not a NOT_FOUND error
    if ("code" in result) {
      throw new Error(`Expected subagent but got error: ${result.message}`)
    }
    expect(result.name).toBe("FallbackBot")
    expect(resolved.getSnapshot().subagents).toHaveLength(1)
  })

  test("write delegates to real appSettings when provided", async () => {
    let written: { analyticsEnabled: boolean } | null = null
    const mockSnapshot = makeSnapshot()
    const fakeManager = {
      getSnapshot: () => mockSnapshot,
      write: async (value: { analyticsEnabled: boolean }) => {
        written = value
        return mockSnapshot
      },
    }
    const resolved = buildResolvedAppSettings(fakeManager)
    await resolved.write({ analyticsEnabled: false })
    expect(written!).toEqual({ analyticsEnabled: false })
  })
})
