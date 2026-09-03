/**
 * Provider and model catalog types — extracted from shared/types.ts.
 * Imported via the re-export barrel in types.ts; all external consumers
 * continue to import from "../shared/types" unchanged.
 */

// AgentProvider lives in types.ts and is only needed as a type here.
// import type = erased at compile time → no circular runtime dependency.
import type { AgentProvider } from "./types"

export const DEFAULT_OPENROUTER_SDK_MODEL = "moonshotai/kimi-k2.5:nitro"

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api"
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

export interface OpenRouterModel {
  id: string
  label: string
  contextLength: number
  pricing?: { promptPerTok: number; completionPerTok: number }
}

// ---------------------------------------------------------------------------
// Provider model option primitives
// ---------------------------------------------------------------------------

export interface ProviderModelOption {
  id: string
  label: string
  supportedEfforts?: readonly ClaudeReasoningEffort[]
  aliases?: readonly string[]
  contextWindowOptions?: readonly ProviderContextWindowOption[]
}

export interface ProviderEffortOption {
  id: string
  label: string
}

export interface ProviderContextWindowOption {
  id: ClaudeContextWindow
  label: string
}

export const CLAUDE_REASONING_OPTIONS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "XHigh" },
  { id: "max", label: "Max" },
] as const satisfies readonly ProviderEffortOption[]

export const CODEX_REASONING_OPTIONS = [
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "XHigh" },
] as const satisfies readonly ProviderEffortOption[]

export type ClaudeReasoningEffort = (typeof CLAUDE_REASONING_OPTIONS)[number]["id"]
export type CodexReasoningEffort = (typeof CODEX_REASONING_OPTIONS)[number]["id"]
export type ClaudeContextWindow = "200k" | "1m"
export type ServiceTier = "fast"

export interface ClaudeModelOptions {
  reasoningEffort: ClaudeReasoningEffort
  contextWindow: ClaudeContextWindow
}

export interface CodexModelOptions {
  reasoningEffort: CodexReasoningEffort
  fastMode: boolean
}

export type OpenRouterModelOptions = Record<string, never>

export interface ProviderModelOptionsByProvider {
  claude: ClaudeModelOptions
  codex: CodexModelOptions
  openrouter: OpenRouterModelOptions
}

export interface ProviderPreference<TModelOptions> {
  model: string
  modelOptions: TModelOptions
  planMode: boolean
}

export type ChatProviderPreferences = {
  claude: ProviderPreference<ClaudeModelOptions>
  codex: ProviderPreference<CodexModelOptions>
  openrouter: ProviderPreference<OpenRouterModelOptions>
}

// ---------------------------------------------------------------------------
// Model option defaults and type-guards
// ---------------------------------------------------------------------------

export type ModelOptions = Partial<{
  [K in AgentProvider]: Partial<ProviderModelOptionsByProvider[K]>
}>

export const DEFAULT_CLAUDE_MODEL_OPTIONS = {
  reasoningEffort: "high",
  contextWindow: "200k",
} as const satisfies ClaudeModelOptions

export const DEFAULT_CODEX_MODEL_OPTIONS = {
  reasoningEffort: "high",
  fastMode: false,
} as const satisfies CodexModelOptions

export function isClaudeReasoningEffort(value: string | null | undefined): value is ClaudeReasoningEffort {
  return CLAUDE_REASONING_OPTIONS.some((option) => option.id === value)
}

export function isCodexReasoningEffort(value: string | null | undefined): value is CodexReasoningEffort {
  return CODEX_REASONING_OPTIONS.some((option) => option.id === value)
}

export const CLAUDE_CONTEXT_WINDOW_OPTIONS = [
  { id: "200k", label: "200k" },
  { id: "1m", label: "1M" },
] as const satisfies readonly ProviderContextWindowOption[]

export function isClaudeContextWindow(value: string | null | undefined): value is ClaudeContextWindow {
  return CLAUDE_CONTEXT_WINDOW_OPTIONS.some((option) => option.id === value)
}

// ---------------------------------------------------------------------------
// Provider catalog
// ---------------------------------------------------------------------------

export interface ProviderCatalogEntry {
  id: AgentProvider
  label: string
  defaultModel: string
  defaultEffort?: string
  supportsPlanMode: boolean
  models: ProviderModelOption[]
  efforts: ProviderEffortOption[]
}

const ALL_CLAUDE_EFFORTS: readonly ClaudeReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"]

export const PROVIDERS: ProviderCatalogEntry[] = [
  {
    id: "claude",
    label: "Claude",
    defaultModel: "claude-sonnet-4-6",
    defaultEffort: "high",
    supportsPlanMode: true,
    models: [
      {
        id: "claude-fable-5",
        label: "Fable 5",
        supportedEfforts: ALL_CLAUDE_EFFORTS,
        aliases: ["fable"],
        contextWindowOptions: [...CLAUDE_CONTEXT_WINDOW_OPTIONS],
      },
      {
        id: "claude-opus-5",
        label: "Opus 5",
        supportedEfforts: ALL_CLAUDE_EFFORTS,
        aliases: ["opus-5"],
        contextWindowOptions: [...CLAUDE_CONTEXT_WINDOW_OPTIONS],
      },
      {
        id: "claude-sonnet-5",
        label: "Sonnet 5",
        supportedEfforts: ALL_CLAUDE_EFFORTS,
        aliases: ["sonnet-5"],
        contextWindowOptions: [...CLAUDE_CONTEXT_WINDOW_OPTIONS],
      },
      {
        id: "claude-opus-4-8",
        label: "Opus 4.8",
        supportedEfforts: ALL_CLAUDE_EFFORTS,
        aliases: ["opus-4-8"],
        contextWindowOptions: [...CLAUDE_CONTEXT_WINDOW_OPTIONS],
      },
      {
        id: "claude-opus-4-7",
        label: "Opus 4.7",
        supportedEfforts: ALL_CLAUDE_EFFORTS,
        aliases: ["opus"],
        contextWindowOptions: [...CLAUDE_CONTEXT_WINDOW_OPTIONS],
      },
      {
        id: "claude-sonnet-4-6",
        label: "Sonnet 4.6",
        supportedEfforts: ["low", "medium", "high", "max"],
        aliases: ["sonnet"],
        contextWindowOptions: [...CLAUDE_CONTEXT_WINDOW_OPTIONS],
      },
      {
        id: "claude-haiku-4-5-20251001",
        label: "Haiku 4.5",
        supportedEfforts: ["low", "medium", "high"],
        aliases: ["haiku"],
      },
    ],
    efforts: [...CLAUDE_REASONING_OPTIONS],
  },
  {
    id: "codex",
    label: "Codex",
    defaultModel: "gpt-5.5",
    supportsPlanMode: true,
    models: [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", aliases: ["gpt-5-codex"] },
      { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
    ],
    efforts: [],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: DEFAULT_OPENROUTER_SDK_MODEL,
    supportsPlanMode: true,
    models: [],
    efforts: [],
  },
]

export function getProviderCatalog(provider: AgentProvider): ProviderCatalogEntry {
  const entry = PROVIDERS.find((candidate) => candidate.id === provider)
  if (!entry) {
    throw new Error(`Unknown provider: ${provider}`)
  }
  return entry
}

// ---------------------------------------------------------------------------
// Custom model entries (user-configurable overrides over the catalog)
// ---------------------------------------------------------------------------

export interface CustomModelEntry {
  id: string
  label: string
  provider: "claude" | "codex"
  supportedEfforts?: readonly ClaudeReasoningEffort[]
  aliases?: readonly string[]
  contextWindowOptions?: readonly ProviderContextWindowOption[]
  createdAt: number
  updatedAt: number
}

export interface CustomModelInput {
  id: string
  label: string
  provider: "claude" | "codex"
  supportedEfforts?: readonly ClaudeReasoningEffort[]
  aliases?: readonly string[]
  contextWindowOptions?: readonly ProviderContextWindowOption[]
}

export interface CustomModelPatch {
  label?: string
  supportedEfforts?: readonly ClaudeReasoningEffort[] | null
  aliases?: readonly string[] | null
  contextWindowOptions?: readonly ProviderContextWindowOption[] | null
}

// ---------------------------------------------------------------------------
// Text snippets (keyboard-shortcut text expansions)
// ---------------------------------------------------------------------------

export interface TextSnippet {
  id: string
  shortcut: string
  expansion: string
  createdAt: number
  updatedAt: number
}

export interface TextSnippetInput {
  shortcut: string
  expansion: string
}

export interface TextSnippetPatch {
  shortcut?: string
  expansion?: string
}

// ---------------------------------------------------------------------------
// mergeCustomModels — folds user overrides into the provider catalog
// ---------------------------------------------------------------------------

function customEntryToModelOption(entry: CustomModelEntry): ProviderModelOption {
  return {
    id: entry.id,
    label: entry.label,
    ...(entry.supportedEfforts ? { supportedEfforts: entry.supportedEfforts } : {}),
    ...(entry.aliases ? { aliases: entry.aliases } : {}),
    ...(entry.contextWindowOptions ? { contextWindowOptions: entry.contextWindowOptions } : {}),
  }
}

export function mergeCustomModels(
  base: ProviderCatalogEntry[],
  customModels: readonly CustomModelEntry[],
): ProviderCatalogEntry[] {
  return base.map((entry) => {
    if (entry.id !== "claude" && entry.id !== "codex") return { ...entry, models: [...entry.models] }
    const forProvider = customModels.filter((m) => m.provider === entry.id)
    if (forProvider.length === 0) return { ...entry, models: [...entry.models] }
    const models = [...entry.models]
    for (const custom of forProvider) {
      const option = customEntryToModelOption(custom)
      const idx = models.findIndex((m) => m.id === option.id)
      // An override MERGES over the built-in rather than replacing it, because
      // the Settings form collects only id/label/efforts — so a hand-added
      // entry for an id that already ships would otherwise strip capabilities
      // it never had a way to declare. `customEntryToModelOption` omits absent
      // optionals, so a field the user did set still wins. There is no
      // "explicitly none" to preserve: `applyCustomModelPatch` collapses a
      // cleared field to `undefined`, indistinguishable from never-set.
      if (idx >= 0) models[idx] = { ...models[idx], ...option }
      else models.push(option)
    }
    return { ...entry, models }
  })
}

// ---------------------------------------------------------------------------
// Provider session helpers and model-id normalization
// ---------------------------------------------------------------------------

/**
 * True when the provider's turns run through the Claude SDK session transport
 * (a live `claudeSessions` entry consumed by `runClaudeSession`, prompts
 * delivered via `session.sendPrompt`) rather than the generic harness-turn
 * transport (`runTurn` over `active.turn.stream`).
 *
 * `claude` and `openrouter` both ride the SDK session — openrouter just points
 * the SDK at OpenRouter's Anthropic-compatible endpoint. Branching on
 * `provider === "claude"` where the real intent is "uses the SDK session" is
 * what silently dropped openrouter's prompt delivery; use this predicate so a
 * new SDK-backed provider can never be forgotten by an `if`-chain again.
 */
export function providerUsesSdkSession(provider: AgentProvider): boolean {
  return provider === "claude" || provider === "openrouter"
}

function catalogModelsFor(
  provider: AgentProvider,
  customModels?: readonly CustomModelEntry[],
): readonly ProviderModelOption[] {
  const catalog = getProviderCatalog(provider)
  if (!customModels || customModels.length === 0) return catalog.models
  const [merged] = mergeCustomModels([{ ...catalog, models: [...catalog.models] }], customModels)
  return merged.models
}

function getProviderModelMatch(
  provider: AgentProvider,
  modelId?: string,
  customModels?: readonly CustomModelEntry[],
): ProviderModelOption | undefined {
  if (!modelId) return undefined
  const models = catalogModelsFor(provider, customModels)
  return models.find((c) => c.id === modelId) ?? models.find((c) => c.aliases?.includes(modelId))
}

export function normalizeProviderModelId(
  provider: AgentProvider,
  modelId?: string,
  fallbackModelId?: string,
  customModels?: readonly CustomModelEntry[],
): string {
  return getProviderModelMatch(provider, modelId, customModels)?.id
    ?? fallbackModelId
    ?? getProviderCatalog(provider).defaultModel
}

export function normalizeClaudeModelId(
  modelId?: string,
  fallbackModelId = "claude-opus-4-7",
  customModels?: readonly CustomModelEntry[],
): string {
  return normalizeProviderModelId("claude", modelId, fallbackModelId, customModels)
}

export function normalizeCodexModelId(
  modelId?: string,
  fallbackModelId = "gpt-5.5",
  customModels?: readonly CustomModelEntry[],
): string {
  return normalizeProviderModelId("codex", modelId, fallbackModelId, customModels)
}

export function getProviderModelOption(
  provider: AgentProvider,
  modelId: string,
  customModels?: readonly CustomModelEntry[],
): ProviderModelOption | undefined {
  const normalizedModelId = normalizeProviderModelId(provider, modelId, undefined, customModels)
  return catalogModelsFor(provider, customModels).find((candidate) => candidate.id === normalizedModelId)
}

export function getClaudeModelOption(
  modelId: string,
  customModels?: readonly CustomModelEntry[],
): ProviderModelOption | undefined {
  return getProviderModelOption("claude", modelId, customModels)
}

export function supportsClaudeMaxReasoningEffort(
  modelId: string,
  customModels?: readonly CustomModelEntry[],
): boolean {
  return Boolean(getClaudeModelOption(modelId, customModels)?.supportedEfforts?.includes("max"))
}

export function getClaudeModelEffortOptions(
  modelId: string,
  customModels?: readonly CustomModelEntry[],
): readonly (typeof CLAUDE_REASONING_OPTIONS)[number][] {
  const supported = getClaudeModelOption(modelId, customModels)?.supportedEfforts
  if (!supported || supported.length === 0) return []
  return CLAUDE_REASONING_OPTIONS.filter((o) => supported.includes(o.id))
}

export function normalizeClaudeReasoningEffort(
  modelId: string,
  effort: ClaudeReasoningEffort,
  customModels?: readonly CustomModelEntry[],
): ClaudeReasoningEffort {
  const supported = getClaudeModelOption(modelId, customModels)?.supportedEfforts
  if (!supported || supported.length === 0) return effort
  if (supported.includes(effort)) return effort
  const priority: ClaudeReasoningEffort[] = ["max", "xhigh", "high", "medium", "low"]
  for (const level of priority) {
    if (supported.includes(level)) return level
  }
  return DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort
}

export function getClaudeContextWindowOptions(
  modelId: string,
  customModels?: readonly CustomModelEntry[],
): readonly ProviderContextWindowOption[] {
  return getClaudeModelOption(modelId, customModels)?.contextWindowOptions ?? []
}

export function normalizeClaudeContextWindow(
  modelId: string,
  contextWindow?: string,
  customModels?: readonly CustomModelEntry[],
): ClaudeContextWindow {
  const options = getClaudeContextWindowOptions(modelId, customModels)
  if (options.length === 0) return DEFAULT_CLAUDE_MODEL_OPTIONS.contextWindow
  return isClaudeContextWindow(contextWindow) && options.some((option) => option.id === contextWindow)
    ? contextWindow
    : DEFAULT_CLAUDE_MODEL_OPTIONS.contextWindow
}

/**
 * The context-window options a custom entry effectively offers: its own when it
 * declares them, else the built-in's — the same fallback `mergeCustomModels`
 * applies. The Settings editor reads this so that saving an entry which was
 * inheriting 1M does not silently write the inheritance away.
 */
export function effectiveContextWindowOptions(
  provider: "claude" | "codex",
  modelId: string,
  declared?: readonly ProviderContextWindowOption[],
): readonly ProviderContextWindowOption[] {
  if (declared) return declared
  return PROVIDERS
    .find((p) => p.id === provider)?.models
    .find((m) => m.id === modelId)?.contextWindowOptions ?? []
}

export function resolveClaudeApiModelId(modelId: string, contextWindow?: ClaudeContextWindow): string {
  return contextWindow === "1m" ? `${modelId}[1m]` : modelId
}

export function resolveClaudeContextWindowTokens(contextWindow: ClaudeContextWindow): number {
  switch (contextWindow) {
    case "1m":
      return 1_000_000
    case "200k":
    default:
      return 200_000
  }
}
