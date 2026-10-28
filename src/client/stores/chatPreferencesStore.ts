import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  type AgentProvider,
  type ChatProviderPreferences,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type CustomModelEntry,
  type DefaultProviderPreference,
  type ProviderPreference,
  type ProviderModelOptionsByProvider,
  isEndpointProvider,
} from "../../shared/types"
import { useAppSettingsStore } from "./appSettingsStore"
import { createDefaultProviderDefaults, normalizeClaudePreference, normalizeCodexPreference } from "../../shared/settings/provider-defaults"
import { claudeOptionsPatch, codexOptionsPatch } from "./providerOptionsPatch"
import { providerDefaultsEqual } from "./providerDefaultsEqual"
import { log } from "../../shared/log"

function currentCustomModels(): readonly CustomModelEntry[] {
  return useAppSettingsStore.getState().settings?.customModels ?? []
}

export type { ChatProviderPreferences, DefaultProviderPreference, ProviderPreference }

export type ComposerState =
  | {
    provider: "claude"
    model: string
    modelOptions: ClaudeModelOptions
    planMode: boolean
  }
  | {
    provider: "codex"
    model: string
    modelOptions: CodexModelOptions
    planMode: boolean
  }
  | {
    provider: "openrouter" | "custom"
    model: string
    modelOptions: Record<string, never>
    planMode: boolean
  }

export const NEW_CHAT_COMPOSER_ID = "__new__"

function logChatPreferences(message: string, details?: object) {
  if (details === undefined) {
    log.info(`[chat-preferences] ${message}`)
    return
  }

  log.info(`[chat-preferences] ${message}`, details)
}

function composerFromProviderDefaults(
  provider: AgentProvider,
  providerDefaults: ChatProviderPreferences
): ComposerState {
  if (provider === "claude") {
    const preference = providerDefaults.claude
    return {
      provider: "claude",
      model: preference.model,
      modelOptions: { ...preference.modelOptions },
      planMode: preference.planMode,
    }
  }

  if (isEndpointProvider(provider)) {
    const preference = providerDefaults[provider]
    return {
      provider,
      model: preference.model,
      modelOptions: {},
      planMode: preference.planMode,
    }
  }

  const preference = providerDefaults.codex
  return {
    provider: "codex",
    model: preference.model,
    modelOptions: { ...preference.modelOptions },
    planMode: preference.planMode,
  }
}

function cloneComposerState(state: ComposerState): ComposerState {
  if (state.provider === "claude") {
    return {
      provider: "claude",
      model: state.model,
      modelOptions: { ...state.modelOptions },
      planMode: state.planMode,
    }
  }
  if (state.provider === "codex") {
    return {
      provider: "codex",
      model: state.model,
      modelOptions: { ...state.modelOptions },
      planMode: state.planMode,
    }
  }
  return {
    provider: state.provider,
    model: state.model,
    modelOptions: {},
    planMode: state.planMode,
  }
}

function createComposerStateForNewChat(args: {
  defaultProvider: DefaultProviderPreference
  providerDefaults: ChatProviderPreferences
  sourceState?: ComposerState | null
  providerHint?: AgentProvider | null
}): ComposerState {
  if (args.providerHint) {
    return composerFromProviderDefaults(args.providerHint, args.providerDefaults)
  }

  if (args.defaultProvider === "last_used") {
    if (args.sourceState) {
      return cloneComposerState(args.sourceState)
    }

    return composerFromProviderDefaults("claude", args.providerDefaults)
  }

  return composerFromProviderDefaults(args.defaultProvider, args.providerDefaults)
}

function getStoredComposerState(
  state: Pick<ChatPreferencesState, "chatStates" | "defaultProvider" | "providerDefaults">,
  chatId: string
): ComposerState {
  const existingState = state.chatStates[chatId]
  if (existingState) {
    return existingState
  }

  return createComposerStateForNewChat({
    defaultProvider: state.defaultProvider,
    providerDefaults: state.providerDefaults,
  })
}

function withChatComposerState(
  state: Pick<ChatPreferencesState, "chatStates" | "defaultProvider" | "providerDefaults">,
  chatId: string,
  transform: (composerState: ComposerState) => ComposerState
) {
  const currentComposerState = getStoredComposerState(state, chatId)
  return {
    chatStates: {
      ...state.chatStates,
      [chatId]: transform(currentComposerState),
    },
  }
}

interface ChatPreferencesState {
  defaultProvider: DefaultProviderPreference
  providerDefaults: ChatProviderPreferences
  chatStates: Record<string, ComposerState>
  pendingProviderSyncChatIds: Set<string>
  setDefaultProvider: (provider: DefaultProviderPreference) => void
  applyServerDefaults: (
    defaultProvider: DefaultProviderPreference,
    providerDefaults: ChatProviderPreferences
  ) => void
  setProviderDefaultModel: (provider: AgentProvider, model: string) => void
  setProviderDefaultModelOptions: <TProvider extends AgentProvider>(
    provider: TProvider,
    modelOptions: Partial<ProviderModelOptionsByProvider[TProvider]>
  ) => void
  setProviderDefaultPlanMode: (provider: AgentProvider, planMode: boolean) => void
  getComposerState: (chatId: string) => ComposerState
  initializeComposerForChat: (
    chatId: string,
    options?: { sourceState?: ComposerState | null; providerHint?: AgentProvider | null }
  ) => void
  setComposerState: (chatId: string, composerState: ComposerState) => void
  setChatComposerProvider: (chatId: string, provider: AgentProvider) => void
  setChatComposerModel: (chatId: string, model: string) => void
  setChatComposerModelOptions: (
    chatId: string,
    modelOptions: Partial<ClaudeModelOptions> | Partial<CodexModelOptions>
  ) => void
  setChatComposerPlanMode: (chatId: string, planMode: boolean) => void
  resetChatComposerFromProvider: (chatId: string, provider: AgentProvider) => void
  forgetChats: (chatIds: readonly string[]) => void
}

export const useChatPreferencesStore = create<ChatPreferencesState>()(
  persist(
    (set, get) => ({
    defaultProvider: "last_used",
    providerDefaults: createDefaultProviderDefaults(),
    chatStates: {},
    pendingProviderSyncChatIds: new Set<string>(),
    setDefaultProvider: (defaultProvider) => set({ defaultProvider }),
      applyServerDefaults: (defaultProvider, providerDefaults) =>
        set((state) => {
          const unchanged =
            state.defaultProvider === defaultProvider
            && providerDefaultsEqual(state.providerDefaults, providerDefaults)
          if (unchanged) {
            return { defaultProvider, providerDefaults }
          }
          const { [NEW_CHAT_COMPOSER_ID]: _staleNewChat, ...remainingChatStates } = state.chatStates
          return { defaultProvider, providerDefaults, chatStates: remainingChatStates }
        }),
      setProviderDefaultModel: (provider, model) =>
        set((state) => {
          const customModels = currentCustomModels()
          if (provider === "claude") {
            return {
              providerDefaults: {
                ...state.providerDefaults,
                [provider]: normalizeClaudePreference({ ...state.providerDefaults.claude, model }, customModels),
              },
            }
          }
          if (isEndpointProvider(provider)) {
            return {
              providerDefaults: {
                ...state.providerDefaults,
                [provider]: { ...state.providerDefaults[provider], model },
              },
            }
          }
          return {
            providerDefaults: {
              ...state.providerDefaults,
              [provider]: normalizeCodexPreference({ ...state.providerDefaults.codex, model }, customModels),
            },
          }
        }),
      setProviderDefaultModelOptions: (provider, modelOptions) =>
        set((state) => {
          const customModels = currentCustomModels()
          if (provider === "claude") {
            const claudeOptions = claudeOptionsPatch(modelOptions)
            return {
              providerDefaults: {
                ...state.providerDefaults,
                [provider]: normalizeClaudePreference({
                  ...state.providerDefaults.claude,
                  modelOptions: {
                    ...state.providerDefaults.claude.modelOptions,
                    ...claudeOptions,
                  },
                }, customModels),
              },
            }
          }
          if (isEndpointProvider(provider)) {
            return {
              providerDefaults: {
                ...state.providerDefaults,
                [provider]: { ...state.providerDefaults[provider], modelOptions: {} },
              },
            }
          }
          const codexOptions = codexOptionsPatch(modelOptions)
          return {
            providerDefaults: {
              ...state.providerDefaults,
              [provider]: normalizeCodexPreference({
                ...state.providerDefaults.codex,
                modelOptions: {
                  ...state.providerDefaults.codex.modelOptions,
                  ...codexOptions,
                },
              }, customModels),
            },
          }
        }),
      setProviderDefaultPlanMode: (provider, planMode) =>
        set((state) => ({
          providerDefaults: {
            ...state.providerDefaults,
            [provider]: {
              ...state.providerDefaults[provider],
              planMode,
            },
          },
        })),
      getComposerState: (chatId) => cloneComposerState(getStoredComposerState(get(), chatId)),
      initializeComposerForChat: (chatId, options) =>
        set((state) => {
          const existingState = state.chatStates[chatId]
          const providerHint = options?.providerHint

          if (existingState) {
            if (providerHint && state.pendingProviderSyncChatIds.has(chatId)) {
              const newPending = new Set(state.pendingProviderSyncChatIds)
              newPending.delete(chatId)
              if (existingState.provider === providerHint) {
                logChatPreferences("initializeComposerForChat sync skipped", { chatId, provider: providerHint })
                return { pendingProviderSyncChatIds: newPending }
              }
              const syncedState = composerFromProviderDefaults(providerHint, state.providerDefaults)
              const updated = { ...syncedState, planMode: existingState.planMode }
              logChatPreferences("initializeComposerForChat sync", { chatId, provider: providerHint })
              return {
                chatStates: { ...state.chatStates, [chatId]: updated },
                pendingProviderSyncChatIds: newPending,
              }
            }
            return state
          }

          const composerState = createComposerStateForNewChat({
            defaultProvider: state.defaultProvider,
            providerDefaults: state.providerDefaults,
            sourceState: options?.sourceState,
            providerHint,
          })

          logChatPreferences("initializeComposerForChat", { chatId, composerState })

          const newPending = providerHint
            ? state.pendingProviderSyncChatIds
            : new Set([...state.pendingProviderSyncChatIds, chatId])

          return {
            chatStates: { ...state.chatStates, [chatId]: composerState },
            pendingProviderSyncChatIds: newPending,
          }
        }),
      setComposerState: (chatId, composerState) =>
        set((state) => {
          const customModels = currentCustomModels()
          const normalizedClaude = composerState.provider === "claude"
            ? normalizeClaudePreference(composerState, customModels)
            : null
          return {
            chatStates: {
              ...state.chatStates,
              [chatId]: normalizedClaude
                ? {
                  provider: "claude",
                  model: normalizedClaude.model,
                  modelOptions: normalizedClaude.modelOptions,
                  planMode: composerState.planMode,
                }
                : cloneComposerState(composerState),
            },
          }
        }),
      setChatComposerProvider: (chatId, provider) =>
        set((state) => withChatComposerState(state, chatId, () => composerFromProviderDefaults(provider, state.providerDefaults))),
      setChatComposerModel: (chatId, model) =>
        set((state) => withChatComposerState(state, chatId, (composerState) => {
          const customModels = currentCustomModels()
          if (composerState.provider === "claude") {
            const normalized = normalizeClaudePreference({
              ...composerState,
              model,
            }, customModels)
            return {
              provider: "claude",
              model: normalized.model,
              modelOptions: normalized.modelOptions,
              planMode: composerState.planMode,
            }
          }
          if (composerState.provider === "codex") {
            return {
              provider: "codex",
              model,
              modelOptions: normalizeCodexPreference({
                ...composerState,
                model,
              }, customModels).modelOptions,
              planMode: composerState.planMode,
            }
          }
          return {
            provider: composerState.provider,
            model,
            modelOptions: {},
            planMode: composerState.planMode,
          }
        })),
      setChatComposerModelOptions: (chatId, modelOptions) =>
        set((state) => withChatComposerState(state, chatId, (composerState) => {
          const customModels = currentCustomModels()
          if (composerState.provider === "claude") {
            const claudeOptions = claudeOptionsPatch(modelOptions)
            return {
              provider: "claude",
              model: composerState.model,
              modelOptions: normalizeClaudePreference({
                ...composerState,
                modelOptions: {
                  ...composerState.modelOptions,
                  ...claudeOptions,
                },
              }, customModels).modelOptions,
              planMode: composerState.planMode,
            }
          }
          if (composerState.provider === "codex") {
            const codexOptions = codexOptionsPatch(modelOptions)
            return {
              provider: "codex",
              model: composerState.model,
              modelOptions: normalizeCodexPreference({
                ...composerState,
                modelOptions: {
                  ...composerState.modelOptions,
                  ...codexOptions,
                },
              }, customModels).modelOptions,
              planMode: composerState.planMode,
            }
          }
          return {
            provider: composerState.provider,
            model: composerState.model,
            modelOptions: {},
            planMode: composerState.planMode,
          }
        })),
      setChatComposerPlanMode: (chatId, planMode) =>
        set((state) => withChatComposerState(state, chatId, (composerState) => ({
          ...composerState,
          planMode,
        }))),
      resetChatComposerFromProvider: (chatId, provider) =>
        set((state) => {
          const newPending = new Set(state.pendingProviderSyncChatIds)
          newPending.delete(chatId)
          return {
            chatStates: {
              ...state.chatStates,
              [chatId]: composerFromProviderDefaults(provider, state.providerDefaults),
            },
            pendingProviderSyncChatIds: newPending,
          }
        }),

      forgetChats: (chatIds) =>
        set((state) => ({
          chatStates: Object.fromEntries(Object.entries(state.chatStates).filter(([chatId]) => !chatIds.includes(chatId))),
          pendingProviderSyncChatIds: new Set([...state.pendingProviderSyncChatIds].filter((chatId) => !chatIds.includes(chatId))),
        })),
    }),
    {
      name: "chat-preferences-state",
      version: 1,
      partialize: (state) => ({ chatStates: state.chatStates }),
    }
  )
)
