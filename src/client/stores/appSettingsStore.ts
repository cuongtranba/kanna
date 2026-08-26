import { create } from "zustand"
import type { AppSettingsPatch, AppSettingsSnapshot, CustomModelEntry, McpServerConfig, TextSnippet } from "../../shared/types"
import { DEFAULT_TERMINAL_SCROLLBACK } from "../../shared/terminal-scrollback"
import type { ChatSoundId, ChatSoundPreference, EditorPreset } from "../../shared/core-types"

type AppSettingsHydrationStatus = "idle" | "loading" | "ready" | "error"

interface AppSettingsStoreState {
  settings: AppSettingsSnapshot | null
  hydrationStatus: AppSettingsHydrationStatus
  setHydrationStatus: (status: AppSettingsHydrationStatus) => void
  setFromServer: (settings: AppSettingsSnapshot) => void
  applyOptimisticPatch: (patch: AppSettingsPatch) => void
}

export function mergeAppSettingsPatch(
  settings: AppSettingsSnapshot,
  patch: AppSettingsPatch
): AppSettingsSnapshot {
  return {
    ...settings,
    ...patch,
    terminal: {
      ...settings.terminal,
      ...patch.terminal,
    },
    panes: {
      ...settings.panes,
      ...patch.panes,
    },
    editor: {
      ...settings.editor,
      ...patch.editor,
    },
    typography: {
      ...settings.typography,
      ...patch.typography,
    },
    providerDefaults: {
      claude: {
        ...settings.providerDefaults.claude,
        ...patch.providerDefaults?.claude,
        modelOptions: {
          ...settings.providerDefaults.claude.modelOptions,
          ...patch.providerDefaults?.claude?.modelOptions,
        },
      },
      codex: {
        ...settings.providerDefaults.codex,
        ...patch.providerDefaults?.codex,
        modelOptions: {
          ...settings.providerDefaults.codex.modelOptions,
          ...patch.providerDefaults?.codex?.modelOptions,
        },
      },
      openrouter: {
        ...settings.providerDefaults.openrouter,
        ...patch.providerDefaults?.openrouter,
        modelOptions: {},
      },
    },
    cloudflareTunnel: {
      ...settings.cloudflareTunnel,
      ...patch.cloudflareTunnel,
    },
    push: {
      ...settings.push,
      ...patch.push,
    },
    telemetry: {
      ...settings.telemetry,
      ...patch.telemetry,
    },
    claudeAuth: {
      tokens: patch.claudeAuth?.tokens ?? settings.claudeAuth.tokens,
      concurrencyDefault: patch.claudeAuth?.concurrencyDefault ?? settings.claudeAuth.concurrencyDefault,
    },
    auth: {
      ...settings.auth,
      ...patch.auth,
    },
    uploads: {
      ...settings.uploads,
      ...patch.uploads,
    },
    subagents: settings.subagents,
    customMcpServers: settings.customMcpServers,
    customModels: settings.customModels,
    textSnippets: settings.textSnippets,
    claudeDriver: {
      preference: patch.claudeDriver?.preference ?? settings.claudeDriver.preference,
      lifecycle: {
        ...settings.claudeDriver.lifecycle,
        ...patch.claudeDriver?.lifecycle,
      },
    },
    globalPromptAppend: patch.globalPromptAppend ?? settings.globalPromptAppend,
    subagentRuntime: {
      runTimeoutMs: patch.subagentRuntime?.runTimeoutMs ?? settings.subagentRuntime.runTimeoutMs,
      defaultLoopSubagentId: patch.subagentRuntime?.defaultLoopSubagentId !== undefined
        ? patch.subagentRuntime.defaultLoopSubagentId
        : settings.subagentRuntime.defaultLoopSubagentId,
    },
  }
}

export const useAppSettingsStore = create<AppSettingsStoreState>()((set) => ({
  settings: null,
  hydrationStatus: "idle",
  setHydrationStatus: (hydrationStatus) => set({ hydrationStatus }),
  setFromServer: (settings) => set({ settings, hydrationStatus: "ready" }),
  applyOptimisticPatch: (patch) =>
    set((state) => ({
      settings: state.settings ? mergeAppSettingsPatch(state.settings, patch) : state.settings,
    })),
}))

const EMPTY_MCP_SERVERS: readonly McpServerConfig[] = []

export const selectCustomMcpServers = (state: AppSettingsStoreState): readonly McpServerConfig[] =>
  state.settings?.customMcpServers ?? EMPTY_MCP_SERVERS

const EMPTY_CUSTOM_MODELS: readonly CustomModelEntry[] = []

export const selectCustomModels = (state: AppSettingsStoreState): readonly CustomModelEntry[] =>
  state.settings?.customModels ?? EMPTY_CUSTOM_MODELS

const EMPTY_TEXT_SNIPPETS: readonly TextSnippet[] = []

export const selectTextSnippets = (state: AppSettingsStoreState): readonly TextSnippet[] =>
  state.settings?.textSnippets ?? EMPTY_TEXT_SNIPPETS

const DEFAULT_TERMINAL_MIN_COLUMN_WIDTH = 450
const DEFAULT_EDITOR_PRESET: EditorPreset = "cursor"

function defaultEditorCommandTemplate(preset: EditorPreset): string {
  if (preset === "vscode") return "code {path}"
  if (preset === "xcode") return "xed {path}"
  if (preset === "windsurf") return "windsurf {path}"
  return "cursor {path}"
}

export const selectScrollbackLines = (state: AppSettingsStoreState): number =>
  state.settings?.terminal.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK

export const selectMinColumnWidth = (state: AppSettingsStoreState): number =>
  state.settings?.terminal.minColumnWidth ?? DEFAULT_TERMINAL_MIN_COLUMN_WIDTH

export const selectEditorPreset = (state: AppSettingsStoreState): EditorPreset =>
  state.settings?.editor.preset ?? DEFAULT_EDITOR_PRESET

export const selectEditorCommandTemplate = (state: AppSettingsStoreState): string => {
  const preset = state.settings?.editor.preset ?? DEFAULT_EDITOR_PRESET
  const template = state.settings?.editor.commandTemplate
  const trimmed = template?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : defaultEditorCommandTemplate(preset)
}

export const selectChatSoundPreference = (state: AppSettingsStoreState): ChatSoundPreference =>
  state.settings?.chatSoundPreference ?? "always"

export const selectChatSoundId = (state: AppSettingsStoreState): ChatSoundId =>
  state.settings?.chatSoundId ?? "funk"
