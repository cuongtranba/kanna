import { describe, expect, test } from "bun:test"
import {
  AUTH_DEFAULTS,
  CLAUDE_AUTH_DEFAULTS,
  CLAUDE_DRIVER_DEFAULTS,
  CLAUDE_PTY_LIFECYCLE_DEFAULTS,
  CLOUDFLARE_TUNNEL_DEFAULTS,
  PACKAGE_UPDATE_SETTINGS_DEFAULTS,
  PLUGIN_SETTINGS_DEFAULTS,
  PUSH_DEFAULTS,
  TELEMETRY_DEFAULTS,
  TYPOGRAPHY_DEFAULTS,
  UPLOAD_DEFAULTS,
  type AppSettingsSnapshot,
  type McpServerConfig,
} from "../shared/types"
import { buildAgentAppSettingsView } from "./server"
import { DEFAULT_TAB_MIN_WIDTH } from "../shared/pane-tab-width"

function makeSnapshot(overrides: Partial<AppSettingsSnapshot> = {}): AppSettingsSnapshot {
  return {
    analyticsEnabled: true,
    browserSettingsMigrated: false,
    theme: "system",
    typography: TYPOGRAPHY_DEFAULTS,
    chatSoundPreference: "always",
    chatSoundId: "funk",
    terminal: { scrollbackLines: 1000, minColumnWidth: 450 },
    panes: { tabMinWidth: DEFAULT_TAB_MIN_WIDTH },
    editor: { preset: "vscode", commandTemplate: "code {path}" },
    defaultProvider: "last_used",
    providerDefaults: {
      claude: {
        model: "claude-opus-4-7",
        modelOptions: { reasoningEffort: "high", contextWindow: "1m" },
        planMode: false,
      },
      codex: {
        model: "gpt-5.5",
        modelOptions: { reasoningEffort: "high", fastMode: false },
        planMode: false,
      },
      openrouter: {
        model: "moonshotai/kimi-k2.5:nitro",
        modelOptions: {},
        planMode: false,
      },
    },
    warning: null,
    filePathDisplay: "/tmp/settings.json",
    cloudflareTunnel: CLOUDFLARE_TUNNEL_DEFAULTS,
    push: PUSH_DEFAULTS,
    telemetry: TELEMETRY_DEFAULTS,
    auth: AUTH_DEFAULTS,
    claudeAuth: CLAUDE_AUTH_DEFAULTS,
    uploads: UPLOAD_DEFAULTS,
    subagents: [],
    customMcpServers: [],
    customModels: [],
    textSnippets: [],
    claudeDriver: { ...CLAUDE_DRIVER_DEFAULTS, lifecycle: { ...CLAUDE_PTY_LIFECYCLE_DEFAULTS } },
    globalPromptAppend: "",
    shareDefaultTtlHours: 24,
    subagentRuntime: { runTimeoutMs: 600_000, defaultLoopSubagentId: null },
    packageUpdates: { ...PACKAGE_UPDATE_SETTINGS_DEFAULTS },
    plugins: PLUGIN_SETTINGS_DEFAULTS,
    installedPlugins: [],
    ...overrides,
  }
}

describe("buildAgentAppSettingsView", () => {
  test("forwards globalPromptAppend so the agent suffix builder receives it", () => {
    const view = buildAgentAppSettingsView(
      makeSnapshot({
        globalPromptAppend: "1. Always using the C3 skill, no deal.\n2. Must using the question tool when asking the user",
      }),
    )

    expect(view.globalPromptAppend).toBe(
      "1. Always using the C3 skill, no deal.\n2. Must using the question tool when asking the user",
    )
  })

  test("forwards claudeDriver preference and lifecycle", () => {
    const view = buildAgentAppSettingsView(
      makeSnapshot({
        claudeDriver: {
          preference: "pty",
          lifecycle: { ...CLAUDE_PTY_LIFECYCLE_DEFAULTS, idleTimeoutMs: 1234, maxConcurrent: 7 },
        },
      }),
    )

    expect(view.claudeDriver.preference).toBe("pty")
    expect(view.claudeDriver.lifecycle.idleTimeoutMs).toBe(1234)
    expect(view.claudeDriver.lifecycle.maxConcurrent).toBe(7)
  })

  test("preserves an empty globalPromptAppend rather than coercing to undefined", () => {
    const view = buildAgentAppSettingsView(makeSnapshot({ globalPromptAppend: "" }))
    expect(view.globalPromptAppend).toBe("")
  })

  test("forwards customMcpServers so both drivers receive the user's MCP entries", () => {
    const context7: McpServerConfig = {
      id: "mcp-context7",
      name: "context7",
      enabled: true,
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      lastTest: { status: "ok", testedAt: "2026-06-03T00:00:00.000Z", toolCount: 2 },
      transport: "stdio",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: {},
    }
    const view = buildAgentAppSettingsView(makeSnapshot({ customMcpServers: [context7] }))
    expect(view.customMcpServers).toEqual([context7])
  })

  test("returns exactly the keys the AgentCoordinator consumes", () => {
    const view = buildAgentAppSettingsView(makeSnapshot())
    expect(Object.keys(view).sort()).toEqual([
      "claudeDriver",
      "customMcpServers",
      "customModels",
      "globalPromptAppend",
      "subagentRuntime",
    ])
  })
})
