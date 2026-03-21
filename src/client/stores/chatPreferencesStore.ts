import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  type AgentProvider,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type ProviderModelOptionsByProvider,
} from "../../shared/types"

export interface ProviderPreference<TModelOptions> {
  model: string
  modelOptions: TModelOptions
}

type ChatPreferences = {
  claude: ProviderPreference<ClaudeModelOptions>
  codex: ProviderPreference<CodexModelOptions>
}

function normalizeCodexModel(model?: string) {
  return model === "gpt-5-codex" ? "gpt-5.3-codex" : (model ?? "gpt-5.4")
}

function normalizeClaudePreference(value?: {
  model?: string
  effort?: string
  modelOptions?: Partial<ClaudeModelOptions>
}): ProviderPreference<ClaudeModelOptions> {
  const reasoningEffort = value?.modelOptions?.reasoningEffort
  return {
    model: value?.model ?? "opus",
    modelOptions: {
      reasoningEffort: isClaudeReasoningEffort(reasoningEffort)
        ? reasoningEffort
        : isClaudeReasoningEffort(value?.effort)
          ? value.effort
          : DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort,
    },
  }
}

function normalizeCodexPreference(value?: {
  model?: string
  effort?: string
  modelOptions?: Partial<CodexModelOptions>
}): ProviderPreference<CodexModelOptions> {
  const reasoningEffort = value?.modelOptions?.reasoningEffort
  return {
    model: normalizeCodexModel(value?.model),
    modelOptions: {
      reasoningEffort: isCodexReasoningEffort(reasoningEffort)
        ? reasoningEffort
        : isCodexReasoningEffort(value?.effort)
          ? value.effort
          : DEFAULT_CODEX_MODEL_OPTIONS.reasoningEffort,
      fastMode: typeof value?.modelOptions?.fastMode === "boolean"
        ? value.modelOptions.fastMode
        : DEFAULT_CODEX_MODEL_OPTIONS.fastMode,
    },
  }
}

type PersistedChatPreferencesState = Pick<ChatPreferencesState, "provider" | "planMode" | "preferences">

interface ChatPreferencesState {
  provider: AgentProvider
  planMode: boolean
  preferences: ChatPreferences
  setProvider: (provider: AgentProvider) => void
  setModel: (provider: AgentProvider, model: string) => void
  setModelOptions: <TProvider extends AgentProvider>(
    provider: TProvider,
    modelOptions: Partial<ProviderModelOptionsByProvider[TProvider]>
  ) => void
  setPlanMode: (planMode: boolean) => void
}

export const useChatPreferencesStore = create<ChatPreferencesState>()(
  persist(
    (set) => ({
      provider: "claude",
      planMode: false,
      preferences: {
        claude: { model: "sonnet", modelOptions: { ...DEFAULT_CLAUDE_MODEL_OPTIONS } },
        codex: { model: "gpt-5.4", modelOptions: { ...DEFAULT_CODEX_MODEL_OPTIONS } },
      },
      setProvider: (provider) => set({ provider }),
      setModel: (provider, model) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            [provider]: {
              ...state.preferences[provider],
              model,
              modelOptions:
                provider === "claude" && model !== "opus" && state.preferences.claude.modelOptions.reasoningEffort === "max"
                  ? { reasoningEffort: "high" }
                  : state.preferences[provider].modelOptions,
            },
          },
        })),
      setModelOptions: (provider, modelOptions) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            [provider]: {
              ...state.preferences[provider],
              modelOptions: {
                ...state.preferences[provider].modelOptions,
                ...modelOptions,
              },
            },
          },
        })),
      setPlanMode: (planMode) => set({ planMode }),
    }),
    {
      name: "chat-preferences",
      version: 2,
      migrate: (persistedState) => {
        const state = persistedState as Partial<PersistedChatPreferencesState> | undefined

        return {
          provider: state?.provider ?? "claude",
          planMode: state?.planMode ?? false,
          preferences: {
            claude: normalizeClaudePreference(state?.preferences?.claude),
            codex: normalizeCodexPreference(state?.preferences?.codex),
          },
        }
      },
    }
  )
)
