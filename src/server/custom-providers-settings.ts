import {
  CUSTOM_PROVIDER_BASE_URL_MAX,
  customProviderApiKeyHint,
  isValidCustomProviderContextWindow,
  validateCustomProviderShape,
  type CustomProviderCredential,
  type CustomProviderEntry,
  type CustomProviderInput,
  type CustomProviderModel,
  type CustomProviderPatch,
  type CustomProviderPublic,
  type CustomProviderValidationError,
} from "../shared/custom-providers"
import { normalizeAnthropicBaseUrl } from "../shared/anthropic-base-url"
import { isRecord } from "../shared/errors"

export class CustomProviderValidationException extends Error {
  constructor(readonly validationError: CustomProviderValidationError) {
    super(validationError.message)
    this.name = "CustomProviderValidationException"
  }
}

function cleanModels(models: readonly CustomProviderModel[]): CustomProviderModel[] {
  return models.map((model) => ({ id: model.id.trim(), label: model.label.trim() }))
}

function cleanBaseUrl(raw: string): string {
  return normalizeAnthropicBaseUrl(raw, CUSTOM_PROVIDER_BASE_URL_MAX) ?? raw.trim()
}

function withContextWindow(entry: CustomProviderEntry, contextWindow: number | undefined): CustomProviderEntry {
  const { contextWindow: _previous, ...rest } = entry
  return contextWindow === undefined ? rest : { ...rest, contextWindow }
}

function validated(entry: CustomProviderEntry, current: readonly CustomProviderEntry[]): CustomProviderEntry {
  const others = current.filter((candidate) => candidate.id !== entry.id).map((candidate) => candidate.id)
  const error = validateCustomProviderShape(entry, others)
  if (error) throw new CustomProviderValidationException(error)
  return entry
}

export function createCustomProvider(
  input: CustomProviderInput,
  current: readonly CustomProviderEntry[],
): CustomProviderEntry {
  const now = Date.now()
  return validated(
    withContextWindow(
      {
        id: input.id.trim(),
        label: input.label.trim(),
        baseUrl: cleanBaseUrl(input.baseUrl),
        apiKey: input.apiKey.trim(),
        models: cleanModels(input.models),
        createdAt: now,
        updatedAt: now,
      },
      input.contextWindow,
    ),
    current,
  )
}

export function updateCustomProvider(
  existing: CustomProviderEntry,
  patch: CustomProviderPatch,
  current: readonly CustomProviderEntry[],
): CustomProviderEntry {
  const nextKey = patch.apiKey?.trim() ?? ""
  const contextWindow = patch.contextWindow === undefined ? existing.contextWindow : (patch.contextWindow ?? undefined)
  return validated(
    withContextWindow(
      {
        ...existing,
        label: patch.label !== undefined ? patch.label.trim() : existing.label,
        baseUrl: patch.baseUrl !== undefined ? cleanBaseUrl(patch.baseUrl) : existing.baseUrl,
        apiKey: nextKey.length > 0 ? nextKey : existing.apiKey,
        models: patch.models !== undefined ? cleanModels(patch.models) : existing.models,
        updatedAt: Date.now(),
      },
      contextWindow,
    ),
    current.filter((candidate) => candidate.id !== existing.id),
  )
}

export function customProviderNotFound(id: string): CustomProviderValidationException {
  return new CustomProviderValidationException({ code: "NOT_FOUND", message: `custom provider ${id} not found` })
}

export function toPublicCustomProvider(entry: CustomProviderEntry): CustomProviderPublic {
  return {
    id: entry.id,
    label: entry.label,
    baseUrl: entry.baseUrl,
    apiKeyHint: customProviderApiKeyHint(entry.apiKey),
    models: entry.models.map((model) => ({ ...model })),
    ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

export function credentialOfCustomProvider(
  providers: readonly CustomProviderEntry[],
  id: string,
): CustomProviderCredential | null {
  const entry = providers.find((candidate) => candidate.id === id)
  if (!entry) return null
  return { label: entry.label, baseUrl: entry.baseUrl, apiKey: entry.apiKey, contextWindow: entry.contextWindow ?? null }
}

function readModels<T>(raw: T): CustomProviderModel[] {
  if (!Array.isArray(raw)) return []
  const models: CustomProviderModel[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    models.push({
      id: typeof item.id === "string" ? item.id.trim() : "",
      label: typeof item.label === "string" ? item.label.trim() : "",
    })
  }
  return models
}

function readString<T>(raw: T): string {
  return typeof raw === "string" ? raw : ""
}

function readContextWindow<T>(raw: T, label: string, warnings: string[]): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === "number" && isValidCustomProviderContextWindow(raw)) return raw
  warnings.push(`customProviders: ignored invalid contextWindow of ${label}`)
  return undefined
}

function readTimestamp<T>(raw: T): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0
}

export function normalizeCustomProviders<T>(value: T, warnings: string[]): CustomProviderEntry[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    warnings.push("customProviders must be an array")
    return []
  }
  const out: CustomProviderEntry[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const id = readString(raw.id).trim()
    const entry = withContextWindow(
      {
        id,
        label: readString(raw.label).trim(),
        baseUrl: cleanBaseUrl(readString(raw.baseUrl)),
        apiKey: readString(raw.apiKey).trim(),
        models: readModels(raw.models),
        createdAt: readTimestamp(raw.createdAt),
        updatedAt: readTimestamp(raw.updatedAt),
      },
      readContextWindow(raw.contextWindow, id || "entry", warnings),
    )
    const error = validateCustomProviderShape(entry, out.map((candidate) => candidate.id))
    if (error) {
      warnings.push(`customProviders: dropped ${entry.id || "entry"} (${error.message})`)
      continue
    }
    out.push(entry)
  }
  return out
}
