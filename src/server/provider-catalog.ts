import type {
  AgentProvider,
  ClaudeModelOptions,
  CodexModelOptions,
  ModelOptions,
  ProviderCatalogEntry,
  ServiceTier,
  LlmProviderSnapshot,
  CustomModelEntry,
} from "../shared/types"
import {
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  PROVIDERS,
  normalizeClaudeContextWindow,
  normalizeProviderModelId,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  mergeCustomModels,
} from "../shared/types"

export const SERVER_PROVIDERS: ProviderCatalogEntry[] = [...PROVIDERS]

export function getServerProviderCatalog(provider: AgentProvider): ProviderCatalogEntry {
  const entry = SERVER_PROVIDERS.find((candidate) => candidate.id === provider)
  if (!entry) {
    throw new Error(`Unknown provider: ${provider}`)
  }
  return entry
}

export function normalizeServerModel(
  provider: AgentProvider,
  model?: string,
  customModels: readonly CustomModelEntry[] = [],
): string {
  const merged = mergeCustomModels([...SERVER_PROVIDERS], customModels)
  const catalog = merged.find((candidate) => candidate.id === provider) ?? getServerProviderCatalog(provider)
  const match = model
    ? catalog.models.find((candidate) => candidate.id === model || candidate.aliases?.includes(model))
    : undefined
  if (match) return match.id
  const normalizedModel = normalizeProviderModelId(provider, model, catalog.defaultModel)
  if (catalog.models.some((candidate) => candidate.id === normalizedModel)) {
    return normalizedModel
  }
  return catalog.defaultModel
}

export function normalizeClaudeModelOptions(
  model: string,
  modelOptions?: ModelOptions,
  legacyEffort?: string,
  customModels?: readonly CustomModelEntry[],
): ClaudeModelOptions {
  const rawEffort = modelOptions?.claude?.reasoningEffort
  let resolvedEffort: ClaudeModelOptions["reasoningEffort"]
  if (isClaudeReasoningEffort(rawEffort)) {
    resolvedEffort = rawEffort
  } else if (isClaudeReasoningEffort(legacyEffort)) {
    resolvedEffort = legacyEffort
  } else {
    resolvedEffort = DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort
  }
  return {
    reasoningEffort: resolvedEffort,
    contextWindow: normalizeClaudeContextWindow(model, modelOptions?.claude?.contextWindow, customModels),
  }
}

export function normalizeCodexModelOptions(modelOptions?: ModelOptions, legacyEffort?: string): CodexModelOptions {
  const rawEffort = modelOptions?.codex?.reasoningEffort
  let resolvedEffort: CodexModelOptions["reasoningEffort"]
  if (isCodexReasoningEffort(rawEffort)) {
    resolvedEffort = rawEffort
  } else if (isCodexReasoningEffort(legacyEffort)) {
    resolvedEffort = legacyEffort
  } else {
    resolvedEffort = DEFAULT_CODEX_MODEL_OPTIONS.reasoningEffort
  }
  return {
    reasoningEffort: resolvedEffort,
    fastMode: typeof modelOptions?.codex?.fastMode === "boolean"
      ? modelOptions.codex.fastMode
      : DEFAULT_CODEX_MODEL_OPTIONS.fastMode,
  }
}

export function codexServiceTierFromModelOptions(modelOptions: CodexModelOptions): ServiceTier | undefined {
  return modelOptions.fastMode ? "fast" : undefined
}

export function isClaudeSdkProvider(provider: AgentProvider): boolean {
  return provider === "claude" || provider === "openrouter"
}

export function openrouterAuthReady(snapshot: LlmProviderSnapshot): boolean {
  return snapshot.provider === "openrouter" && snapshot.enabled && snapshot.apiKey.length > 0
}

/** The read-only c3-224 probes the Claude spawn gate needs. */
export interface ClaudeAuthPoolProbe {
  hasAnyToken(): boolean
  hasUsable(reservedFor?: string): boolean
}

/**
 * Can a Claude spawn proceed for `reservedFor`?
 *
 * This is the single definition of the Claude spawn gate, and it deliberately
 * mirrors what `claude-session-spawner.ts` / `quick-response.ts` express as
 * `pool.hasAnyToken() && !picked` → refuse: an OAuth token is required only
 * once the user has configured one. With an absent or empty pool the driver
 * falls through to the local claude CLI credentials, so the gate must pass.
 *
 * Getting this wrong in only one caller is invisible in the common case and
 * splits behaviour by call site — a user with zero configured tokens had a
 * working main chat and AUTH_REQUIRED on every subagent delegation.
 */
export function claudeAuthReady(
  pool: ClaudeAuthPoolProbe | null | undefined,
  reservedFor?: string,
): boolean {
  if (!pool || !pool.hasAnyToken()) return true
  return pool.hasUsable(reservedFor)
}
