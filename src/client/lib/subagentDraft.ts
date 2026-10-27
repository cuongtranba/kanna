import { isRecord } from "../../shared/errors"
import {
  SUBAGENT_NAME_DISALLOWED_RUN,
  SUBAGENT_NAME_MAX,
} from "../../shared/settings/validation"
import {
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  getProviderCatalog,
  type AgentProvider,
  type ChatProviderPreferences,
  type ProviderCatalogEntry,
  type Subagent,
  type SubagentInput,
  type SubagentPatch,
  type SubagentTriggerMode,
  type SubagentValidationError,
  type SubagentValidationErrorCode,
} from "../../shared/types"

export const DEFAULT_SUBAGENT_TRIGGER_MODE: SubagentTriggerMode = "auto"

export function effectiveTriggerMode(draft: Pick<SubagentInput, "triggerMode">): SubagentTriggerMode {
  return draft.triggerMode ?? DEFAULT_SUBAGENT_TRIGGER_MODE
}

function defaultModelFor(
  provider: AgentProvider,
  providerDefaults: ChatProviderPreferences | undefined,
  availableProviders: ProviderCatalogEntry[] | undefined,
): string {
  return (
    providerDefaults?.[provider].model
    || availableProviders?.find((entry) => entry.id === provider)?.defaultModel
    || getProviderCatalog(provider).defaultModel
  )
}

function defaultModelOptionsFor(
  provider: AgentProvider,
  providerDefaults: ChatProviderPreferences | undefined,
): SubagentInput["modelOptions"] {
  if (provider === "claude") return { ...(providerDefaults?.claude.modelOptions ?? DEFAULT_CLAUDE_MODEL_OPTIONS) }
  if (provider === "codex") return { ...(providerDefaults?.codex.modelOptions ?? DEFAULT_CODEX_MODEL_OPTIONS) }
  return {}
}

export function createDefaultSubagentDraft(
  provider: AgentProvider,
  providerDefaults: ChatProviderPreferences | undefined,
  availableProviders?: ProviderCatalogEntry[],
): SubagentInput {
  return {
    name: "",
    provider,
    model: defaultModelFor(provider, providerDefaults, availableProviders),
    modelOptions: defaultModelOptionsFor(provider, providerDefaults),
    systemPrompt: "",
    contextScope: "previous-assistant-reply",
    triggerMode: DEFAULT_SUBAGENT_TRIGGER_MODE,
  }
}

export function toSubagentInput(subagent: Subagent): SubagentInput {
  return {
    name: subagent.name,
    description: subagent.description,
    provider: subagent.provider,
    model: subagent.model,
    modelOptions: subagent.modelOptions,
    systemPrompt: subagent.systemPrompt,
    contextScope: subagent.contextScope,
    triggerMode: subagent.triggerMode,
    workingDir: subagent.workingDir,
    allowedPaths: subagent.allowedPaths,
    maxTurns: subagent.maxTurns,
    allowBeaconTools: subagent.allowBeaconTools,
  }
}

export function toSubagentPatch(draft: SubagentInput): SubagentPatch {
  return { ...draft, maxTurns: draft.maxTurns ?? null }
}

function stringArrayEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function shallowEqualModelOptions(a: SubagentInput["modelOptions"], b: SubagentInput["modelOptions"]): boolean {
  if (!isRecord(a) || !isRecord(b)) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

const DRAFT_FIELD_EQUALITY: Record<keyof SubagentInput, (a: SubagentInput, b: SubagentInput) => boolean> = {
  name: (a, b) => a.name === b.name,
  description: (a, b) => (a.description ?? "") === (b.description ?? ""),
  provider: (a, b) => a.provider === b.provider,
  model: (a, b) => a.model === b.model,
  modelOptions: (a, b) => shallowEqualModelOptions(a.modelOptions, b.modelOptions),
  systemPrompt: (a, b) => a.systemPrompt === b.systemPrompt,
  contextScope: (a, b) => a.contextScope === b.contextScope,
  triggerMode: (a, b) => effectiveTriggerMode(a) === effectiveTriggerMode(b),
  workingDir: (a, b) => (a.workingDir ?? "") === (b.workingDir ?? ""),
  allowedPaths: (a, b) => stringArrayEqual(a.allowedPaths, b.allowedPaths),
  maxTurns: (a, b) => (a.maxTurns ?? null) === (b.maxTurns ?? null),
  allowBeaconTools: (a, b) => (a.allowBeaconTools ?? false) === (b.allowBeaconTools ?? false),
}

export function isSubagentDraftDirty(draft: SubagentInput, baseline: SubagentInput): boolean {
  return Object.values(DRAFT_FIELD_EQUALITY).some((equal) => !equal(draft, baseline))
}

export type SubagentFieldKey = "name" | "general"

export interface SubagentFieldError {
  field: SubagentFieldKey
  message: string
}

const NAME_FIELD_CODES = new Set<SubagentValidationErrorCode>([
  "EMPTY_NAME",
  "INVALID_CHAR",
  "RESERVED_NAME",
  "DUPLICATE_NAME",
  "TOO_LONG",
])

export function mapSubagentValidationError(error: SubagentValidationError): SubagentFieldError {
  if (NAME_FIELD_CODES.has(error.code)) {
    return { field: "name", message: error.message }
  }
  return { field: "general", message: error.message }
}

export function sanitizeSubagentNameInput(value: string): string {
  return value
    .toLowerCase()
    .replace(SUBAGENT_NAME_DISALLOWED_RUN, "-")
    .slice(0, SUBAGENT_NAME_MAX)
}
