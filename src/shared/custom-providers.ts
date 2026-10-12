import { normalizeAnthropicBaseUrl } from "./app-settings-types"
import type { ProviderCatalogEntry } from "./provider-model-types"

export const CUSTOM_PROVIDER_ID_REGEX = /^[a-z][a-z0-9-]{0,31}$/
export const CUSTOM_PROVIDER_LABEL_MAX = 64
export const CUSTOM_PROVIDER_MODEL_ID_MAX = 128
export const CUSTOM_PROVIDER_MODEL_LABEL_MAX = 64
export const CUSTOM_PROVIDER_MAX_MODELS = 50
export const CUSTOM_PROVIDER_API_KEY_MAX = 1024
export const CUSTOM_PROVIDER_API_KEY_HINT_MIN_LENGTH = 8
export const CUSTOM_PROVIDER_API_KEY_HINT_LENGTH = 4
export const CUSTOM_PROVIDER_CONTEXT_WINDOW_MIN = 4096
export const CUSTOM_PROVIDER_CONTEXT_WINDOW_MAX = 2_000_000

const MODEL_ID_REGEX = /^\S+$/

export interface CustomProviderModel {
  id: string
  label: string
}

export interface CustomProviderEntry {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  models: CustomProviderModel[]
  contextWindow?: number
  createdAt: number
  updatedAt: number
}

export interface CustomProviderPublic {
  id: string
  label: string
  baseUrl: string
  apiKeyHint: string | null
  models: CustomProviderModel[]
  contextWindow?: number
  createdAt: number
  updatedAt: number
}

export interface CustomProviderInput {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  models: CustomProviderModel[]
  contextWindow?: number
}

export interface CustomProviderPatch {
  label?: string
  baseUrl?: string
  apiKey?: string
  models?: CustomProviderModel[]
  contextWindow?: number | null
}

export interface CustomProviderCredential {
  label: string
  baseUrl: string
  apiKey: string
  contextWindow: number | null
}

export type CustomProviderValidationCode =
  | "INVALID_ID"
  | "EMPTY_LABEL"
  | "INVALID_BASE_URL"
  | "MISSING_API_KEY"
  | "NO_MODELS"
  | "INVALID_MODEL"
  | "DUPLICATE_MODEL"
  | "INVALID_CONTEXT_WINDOW"
  | "DUPLICATE_ID"
  | "NOT_FOUND"

export interface CustomProviderValidationError {
  code: CustomProviderValidationCode
  field?: string
  message: string
}

export interface ParsedCustomModelId {
  providerId: string
  vendorModel: string
}

export function encodeCustomModelId(providerId: string, vendorModel: string): string {
  return `${providerId}/${vendorModel}`
}

export function parseCustomModelId(id: string): ParsedCustomModelId | null {
  const separator = id.indexOf("/")
  if (separator <= 0) return null
  const providerId = id.slice(0, separator)
  const vendorModel = id.slice(separator + 1)
  if (!CUSTOM_PROVIDER_ID_REGEX.test(providerId) || vendorModel.length === 0) return null
  return { providerId, vendorModel }
}

export function customProviderModelOptions(
  providers: readonly Pick<CustomProviderPublic, "id" | "label" | "models">[],
): ProviderCatalogEntry["models"] {
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({
      id: encodeCustomModelId(provider.id, model.id),
      label: `${provider.label} · ${model.label || model.id}`,
    })),
  )
}

export function withCustomProviders(
  catalog: ProviderCatalogEntry[],
  providers: readonly CustomProviderPublic[],
): ProviderCatalogEntry[] {
  const models = customProviderModelOptions(providers)
  const first = models[0]
  if (!first) return catalog.filter((entry) => entry.id !== "custom")
  return catalog.map((entry) =>
    entry.id === "custom" ? { ...entry, defaultModel: first.id, models } : entry,
  )
}

export function isConfiguredCustomModel(
  providers: readonly Pick<CustomProviderPublic, "id" | "models">[],
  modelId: string,
): boolean {
  const parsed = parseCustomModelId(modelId)
  if (!parsed) return false
  const provider = providers.find((candidate) => candidate.id === parsed.providerId)
  return provider?.models.some((model) => model.id === parsed.vendorModel) ?? false
}

export function firstCustomModelId(
  providers: readonly Pick<CustomProviderPublic, "id" | "label" | "models">[],
): string | null {
  return customProviderModelOptions(providers)[0]?.id ?? null
}

export function customProviderApiKeyHint(apiKey: string): string | null {
  if (apiKey.length < CUSTOM_PROVIDER_API_KEY_HINT_MIN_LENGTH) return null
  return apiKey.slice(-CUSTOM_PROVIDER_API_KEY_HINT_LENGTH)
}

export function isValidCustomProviderContextWindow(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= CUSTOM_PROVIDER_CONTEXT_WINDOW_MIN &&
    value <= CUSTOM_PROVIDER_CONTEXT_WINDOW_MAX
  )
}

function validateModels(models: readonly CustomProviderModel[]): CustomProviderValidationError | null {
  if (models.length === 0) {
    return { code: "NO_MODELS", field: "models", message: "add at least one model" }
  }
  if (models.length > CUSTOM_PROVIDER_MAX_MODELS) {
    return { code: "INVALID_MODEL", field: "models", message: `at most ${CUSTOM_PROVIDER_MAX_MODELS} models` }
  }
  const seen = new Set<string>()
  for (const model of models) {
    if (
      model.id.length === 0 ||
      model.id.length > CUSTOM_PROVIDER_MODEL_ID_MAX ||
      !MODEL_ID_REGEX.test(model.id) ||
      model.label.length > CUSTOM_PROVIDER_MODEL_LABEL_MAX
    ) {
      return { code: "INVALID_MODEL", field: "models", message: `invalid model '${model.id}'` }
    }
    if (seen.has(model.id)) {
      return { code: "DUPLICATE_MODEL", field: "models", message: `model '${model.id}' is listed twice` }
    }
    seen.add(model.id)
  }
  return null
}

export function validateCustomProviderShape(
  entry: Pick<CustomProviderEntry, "id" | "label" | "baseUrl" | "apiKey" | "models" | "contextWindow">,
  otherIds: readonly string[],
): CustomProviderValidationError | null {
  if (!CUSTOM_PROVIDER_ID_REGEX.test(entry.id)) {
    return { code: "INVALID_ID", field: "id", message: `id must match ${CUSTOM_PROVIDER_ID_REGEX}` }
  }
  if (otherIds.includes(entry.id)) {
    return { code: "DUPLICATE_ID", field: "id", message: `provider '${entry.id}' already exists` }
  }
  if (entry.label.trim().length === 0 || entry.label.length > CUSTOM_PROVIDER_LABEL_MAX) {
    return { code: "EMPTY_LABEL", field: "label", message: `label must be non-empty and <= ${CUSTOM_PROVIDER_LABEL_MAX} chars` }
  }
  if (normalizeAnthropicBaseUrl(entry.baseUrl) === null) {
    return { code: "INVALID_BASE_URL", field: "baseUrl", message: "base URL must start with http:// or https://" }
  }
  if (entry.apiKey.length === 0 || entry.apiKey.length > CUSTOM_PROVIDER_API_KEY_MAX) {
    return { code: "MISSING_API_KEY", field: "apiKey", message: `an API key of 1-${CUSTOM_PROVIDER_API_KEY_MAX} characters is required` }
  }
  if (entry.contextWindow !== undefined && !isValidCustomProviderContextWindow(entry.contextWindow)) {
    return {
      code: "INVALID_CONTEXT_WINDOW",
      field: "contextWindow",
      message: `context window must be a whole number of tokens between ${CUSTOM_PROVIDER_CONTEXT_WINDOW_MIN} and ${CUSTOM_PROVIDER_CONTEXT_WINDOW_MAX}`,
    }
  }
  return validateModels(entry.models)
}
