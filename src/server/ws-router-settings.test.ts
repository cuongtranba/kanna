import { describe, expect, mock, test } from "bun:test"
import { handleSettingsCommand, isSubagentValidationError } from "./ws-router-settings"
import type { SettingsCommandDeps } from "./ws-router-settings"
import type { AppSettingsSnapshot, Subagent, SubagentValidationError } from "../shared/types"
import type { ClientCommand } from "../shared/protocol"
import {
  AUTH_DEFAULTS,
  CLAUDE_AUTH_DEFAULTS,
  CLAUDE_DRIVER_DEFAULTS,
  CLAUDE_LIFECYCLE_DEFAULTS,
  CLOUDFLARE_TUNNEL_DEFAULTS,
  DEFAULT_OPENROUTER_SDK_MODEL,
  PACKAGE_UPDATE_SETTINGS_DEFAULTS,
  PLUGIN_SETTINGS_DEFAULTS,
  PROTOCOL_VERSION,
  PUSH_DEFAULTS,
  TELEMETRY_DEFAULTS,
  TYPOGRAPHY_DEFAULTS,
  UPLOAD_DEFAULTS,
} from "../shared/types"
import { KeybindingsManager } from "./keybindings"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULT_TAB_MIN_WIDTH } from "../shared/pane-tab-width"
import { UPDATE_PROTOCOL } from "../shared/beacon-protocol"
import { DEFAULT_BEACON_SCOPE } from "../shared/beacon-scope"
import { createBeaconRegistry } from "./beacon-registry"


function makeSnapshot(): AppSettingsSnapshot {
  return {
    analyticsEnabled: true,
    browserSettingsMigrated: false,
    theme: "system",
    typography: TYPOGRAPHY_DEFAULTS,
    chatSoundPreference: "always",
    chatSoundId: "funk",
    terminal: { scrollbackLines: 1_000, minColumnWidth: 450 },
    panes: { tabMinWidth: DEFAULT_TAB_MIN_WIDTH },
    editor: { preset: "cursor", commandTemplate: "cursor {path}" },
    defaultProvider: "last_used",
    providerDefaults: {
      claude: { model: "claude-opus-4-7", modelOptions: { reasoningEffort: "high", contextWindow: "200k" }, planMode: false },
      codex: { model: "gpt-5.5", modelOptions: { reasoningEffort: "high", fastMode: false }, planMode: false },
      openrouter: { model: DEFAULT_OPENROUTER_SDK_MODEL, modelOptions: {}, planMode: false },
    },
    warning: null,
    filePathDisplay: "~/.kanna/data/settings.json",
    cloudflareTunnel: CLOUDFLARE_TUNNEL_DEFAULTS,
    push: PUSH_DEFAULTS,
    telemetry: TELEMETRY_DEFAULTS,
    auth: AUTH_DEFAULTS,
    claudeAuth: CLAUDE_AUTH_DEFAULTS,
    uploads: UPLOAD_DEFAULTS,
    subagents: [],
    customMcpServers: [],
    customBeacons: [],
    customModels: [],
    textSnippets: [],
    claudeDriver: { ...CLAUDE_DRIVER_DEFAULTS, lifecycle: { ...CLAUDE_LIFECYCLE_DEFAULTS } },
    globalPromptAppend: "",
    shareDefaultTtlHours: 24,
    subagentRuntime: { runTimeoutMs: 600_000, defaultLoopSubagentId: null },
    packageUpdates: { ...PACKAGE_UPDATE_SETTINGS_DEFAULTS },
    plugins: PLUGIN_SETTINGS_DEFAULTS,
    installedPlugins: [],
  }
}

async function makeDeps(tmpDir: string): Promise<SettingsCommandDeps & { sent: unknown[] }> {
  const kb = new KeybindingsManager(path.join(tmpDir, "keybindings.json"))
  const snapshot = makeSnapshot()
  const sent: unknown[] = []

  return {
    keybindings: kb,
    resolvedAppSettings: {
      getSnapshot: () => snapshot,
      write: async (v) => ({ ...snapshot, analyticsEnabled: v.analyticsEnabled }),
      writePatch: async () => snapshot,
      setCloudflareTunnel: async () => snapshot,
      setClaudeAuth: async () => snapshot,
      createSubagent: async () => ({ id: "s1", name: "Test" }) as unknown as Subagent,
      updateSubagent: async () => ({ id: "s1", name: "Test" }) as unknown as Subagent,
      deleteSubagent: async () => {},
    },
    resolvedAnalytics: { track: mock(() => {}) },
    resolvedLlmProvider: {
      read: async () => ({ provider: "openai" as const, apiKey: "", model: "gpt-5.4-mini", baseUrl: "", resolvedBaseUrl: "https://api.openai.com/v1", enabled: false, warning: null, filePathDisplay: "~/.kanna/llm-provider.json" }),
      write: async (v) => ({ ...v, resolvedBaseUrl: "https://api.openai.com/v1", enabled: false, warning: null, filePathDisplay: "~/.kanna/llm-provider.json" }),
      validate: async () => ({ ok: false, error: { type: "config_error" as const, message: "stub" } }),
    },
    listOpenRouterModels: undefined,
    send: (envelope) => { sent.push(envelope) },
    sent,
  }
}


describe("isSubagentValidationError", () => {
  test("returns true for validation error shape", () => {
    const err: SubagentValidationError = { code: "EMPTY_NAME", message: "name is empty" }
    expect(isSubagentValidationError(err)).toBe(true)
  })

  test("returns false for Subagent shape", () => {
    const subagent = { id: "s1", name: "Test", instructions: "" } as unknown as Subagent
    expect(isSubagentValidationError(subagent)).toBe(false)
  })
})


describe("handleSettingsCommand", () => {
  test("settings.readKeybindings → acks with keybindings snapshot", async () => {
    const tmpD = await mkdtemp(path.join(tmpdir(), "ws-settings-test-"))
    try {
      const deps = await makeDeps(tmpD)
      const handled = await handleSettingsCommand(deps, { type: "settings.readKeybindings" }, "req-1")
      expect(handled).toBe(true)
      expect(deps.sent).toHaveLength(1)
      const ack = deps.sent[0] as { type: string; id: string }
      expect(ack.type).toBe("ack")
      expect(ack.id).toBe("req-1")
    } finally {
      await rm(tmpD, { recursive: true, force: true })
    }
  })

  test("settings.readAppSettings → acks with app-settings snapshot", async () => {
    const tmpD = await mkdtemp(path.join(tmpdir(), "ws-settings-test-"))
    try {
      const deps = await makeDeps(tmpD)
      const handled = await handleSettingsCommand(deps, { type: "settings.readAppSettings" }, "req-2")
      expect(handled).toBe(true)
      expect(deps.sent).toHaveLength(1)
      const ack = deps.sent[0] as { type: string; result: AppSettingsSnapshot }
      expect(ack.result.analyticsEnabled).toBe(true)
    } finally {
      await rm(tmpD, { recursive: true, force: true })
    }
  })

  test("subagent.delete → acks ok", async () => {
    const tmpD = await mkdtemp(path.join(tmpdir(), "ws-settings-test-"))
    try {
      const deps = await makeDeps(tmpD)
      const handled = await handleSettingsCommand(deps, { type: "subagent.delete", id: "s1" }, "req-3")
      expect(handled).toBe(true)
      const ack = deps.sent[0] as { result: { ok: boolean } }
      expect(ack.result.ok).toBe(true)
    } finally {
      await rm(tmpD, { recursive: true, force: true })
    }
  })

  test("skills.listInstalled → acks with installed-skills snapshot", async () => {
    const tmpD = await mkdtemp(path.join(tmpdir(), "ws-settings-test-"))
    try {
      const deps = await makeDeps(tmpD)
      const handled = await handleSettingsCommand(deps, { type: "skills.listInstalled" }, "req-4")
      expect(handled).toBe(true)
      const ack = deps.sent[0] as { result: { skills: unknown[] } }
      expect(Array.isArray(ack.result.skills)).toBe(true)
    } finally {
      await rm(tmpD, { recursive: true, force: true })
    }
  })

  test("unrecognized command type → returns false", async () => {
    const tmpD = await mkdtemp(path.join(tmpdir(), "ws-settings-test-"))
    try {
      const deps = await makeDeps(tmpD)
      const handled = await handleSettingsCommand(deps, { type: "chat.create" } as unknown as ClientCommand, "req-5")
      expect(handled).toBe(false)
      expect(deps.sent).toHaveLength(0)
    } finally {
      await rm(tmpD, { recursive: true, force: true })
    }
  })
})

describe("beacons.update", () => {
  function beaconSocket() {
    const sent: string[] = []
    return {
      sent,
      send(payload: string | Buffer): number {
        sent.push(String(payload))
        return sent.length
      },
    }
  }

  async function runUpdate(beaconRegistry: SettingsCommandDeps["beaconRegistry"], beaconId: string) {
    const tmpD = await mkdtemp(path.join(tmpdir(), "ws-settings-test-"))
    try {
      const deps = { ...(await makeDeps(tmpD)), beaconRegistry }
      const handled = await handleSettingsCommand(deps, { type: "beacons.update", beaconId }, "req-update")
      return { handled, sent: deps.sent }
    } finally {
      await rm(tmpD, { recursive: true, force: true })
    }
  }

  test("asks a capable online beacon to update and acks ok", async () => {
    const registry = createBeaconRegistry()
    const socket = beaconSocket()
    registry.connect({ beaconId: "b1", socket, beaconVersion: "1.70.0", protocolVersion: UPDATE_PROTOCOL, scope: DEFAULT_BEACON_SCOPE })
    const { handled, sent } = await runUpdate(registry, "b1")
    expect(handled).toBe(true)
    expect(sent).toEqual([{ v: PROTOCOL_VERSION, type: "ack", id: "req-update", result: { ok: true } }])
    expect(socket.sent.map((raw) => JSON.parse(raw))).toEqual([{ kind: "update" }])
  })

  test("refuses an offline beacon and one below the update protocol with an error ack", async () => {
    const registry = createBeaconRegistry()
    const old = beaconSocket()
    registry.connect({ beaconId: "old", socket: old, beaconVersion: "1.69.0", protocolVersion: UPDATE_PROTOCOL - 1, scope: DEFAULT_BEACON_SCOPE })
    const offline = await runUpdate(registry, "gone")
    const tooOld = await runUpdate(registry, "old")
    expect(offline.sent).toEqual([
      { v: PROTOCOL_VERSION, type: "ack", id: "req-update", result: { ok: false, error: expect.stringContaining("offline") } },
    ])
    expect(tooOld.sent).toEqual([
      { v: PROTOCOL_VERSION, type: "ack", id: "req-update", result: { ok: false, error: expect.stringContaining("reinstall") } },
    ])
    expect(old.sent).toEqual([])
  })

  test("acks an error when the server has no beacon registry", async () => {
    const { handled, sent } = await runUpdate(undefined, "b1")
    expect(handled).toBe(true)
    expect(sent).toEqual([
      { v: PROTOCOL_VERSION, type: "ack", id: "req-update", result: { ok: false, error: expect.any(String) } },
    ])
  })
})
