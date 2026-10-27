import {
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  isEndpointProvider,
  type AgentProvider,
  type ModelOptions,
} from "../../shared/types"
import type { ComposerState } from "../stores/chatPreferencesStore"

export interface ComposerSendOptions {
  provider?: AgentProvider
  model?: string
  modelOptions?: ModelOptions
  planMode?: boolean
}

export function toSendOptions(state: ComposerState, includePlanMode: boolean): ComposerSendOptions {
  return {
    provider: state.provider,
    model: state.model,
    modelOptions: modelOptionsOf(state),
    planMode: includePlanMode ? state.planMode : false,
  }
}

function modelOptionsOf(state: ComposerState): ModelOptions {
  if (state.provider === "claude") return { claude: { ...state.modelOptions } }
  if (state.provider === "codex") return { codex: { ...state.modelOptions } }
  return {}
}

export function fromSendOptions(options?: ComposerSendOptions): ComposerState | null {
  if (!options?.provider || !options.model) return null
  const planMode = Boolean(options.planMode)

  if (options.provider === "claude" && options.modelOptions?.claude) {
    const claude = options.modelOptions.claude
    return {
      provider: "claude",
      model: options.model,
      modelOptions: {
        reasoningEffort: claude.reasoningEffort ?? DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort,
        contextWindow: claude.contextWindow ?? DEFAULT_CLAUDE_MODEL_OPTIONS.contextWindow,
      },
      planMode,
    }
  }

  if (options.provider === "codex" && options.modelOptions?.codex) {
    const codex = options.modelOptions.codex
    return {
      provider: "codex",
      model: options.model,
      modelOptions: {
        reasoningEffort: codex.reasoningEffort ?? DEFAULT_CODEX_MODEL_OPTIONS.reasoningEffort,
        fastMode: codex.fastMode ?? DEFAULT_CODEX_MODEL_OPTIONS.fastMode,
      },
      planMode,
    }
  }

  if (isEndpointProvider(options.provider)) {
    return { provider: options.provider, model: options.model, modelOptions: {}, planMode }
  }

  return null
}
