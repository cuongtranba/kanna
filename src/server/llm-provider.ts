import { homedir } from "node:os"
import path from "node:path"
import OpenAI from "openai"
import type { AnyValue } from "../shared/errors"
import { isRecord } from "../shared/errors"
import { getLlmProviderFilePath } from "../shared/branding"
import {
  DEFAULT_OPENAI_SDK_MODEL,
  DEFAULT_OPENROUTER_SDK_MODEL,
  type LlmProviderKind,
  type LlmProviderSnapshot,
  type LlmProviderValidationResult,
} from "../shared/types"

export {
  readLlmProviderSnapshotFromDisk as readLlmProviderSnapshot,
  writeLlmProviderSnapshotToDisk as writeLlmProviderSnapshot,
} from "./llm-provider-store.adapter"

export const OPENAI_BASE_URL = "https://api.openai.com/v1"
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

const DEFAULT_PROVIDER: LlmProviderKind = "openai"

function formatDisplayPath(filePath: string) {
  const homePath = homedir()
  if (filePath === homePath) return "~"
  if (filePath.startsWith(`${homePath}${path.sep}`)) {
    return `~${filePath.slice(homePath.length)}`
  }
  return filePath
}

function resolveProvider(value: AnyValue) {
  if (value === "openai" || value === "openrouter" || value === "custom") {
    return value
  }
  return null
}

function normalizeString(value: AnyValue) {
  return typeof value === "string" ? value.trim() : ""
}

export function resolveLlmProviderBaseUrl(provider: LlmProviderKind, baseUrl: string) {
  if (provider === "openai") return OPENAI_BASE_URL
  if (provider === "openrouter") return OPENROUTER_BASE_URL
  return baseUrl.trim()
}

export function resolveLlmProviderDefaultModel(provider: LlmProviderKind) {
  if (provider === "openai") return DEFAULT_OPENAI_SDK_MODEL
  if (provider === "openrouter") return DEFAULT_OPENROUTER_SDK_MODEL
  return ""
}

export function normalizeLlmProviderSnapshot(
  value: AnyValue,
  filePath = getLlmProviderFilePath(homedir())
): LlmProviderSnapshot {
  const source = isRecord(value) && !Array.isArray(value) ? value : null
  const warnings: string[] = []

  if (!source) {
    return createDefaultSnapshot(
      filePath,
      value === undefined || value === null ? null : "LLM provider file must contain a JSON object. Using defaults."
    )
  }

  const provider = resolveProvider(source.provider)
  const apiKey = normalizeString(source.apiKey)
  const model = normalizeString(source.model)
  const baseUrl = normalizeString(source.baseUrl)

  if (!provider) {
    warnings.push("provider must be one of openai, openrouter, or custom")
  }
  if (source.apiKey !== undefined && typeof source.apiKey !== "string") {
    warnings.push("apiKey must be a string")
  }
  if (source.model !== undefined && typeof source.model !== "string") {
    warnings.push("model must be a string")
  }
  if (source.baseUrl !== undefined && source.baseUrl !== null && typeof source.baseUrl !== "string") {
    warnings.push("baseUrl must be a string or null")
  }
  if ((provider ?? DEFAULT_PROVIDER) === "custom" && !baseUrl) {
    warnings.push("custom provider requires a baseUrl")
  }

  const normalizedProvider = provider ?? DEFAULT_PROVIDER
  const resolvedModel = model || resolveLlmProviderDefaultModel(normalizedProvider)
  const resolvedBaseUrl = resolveLlmProviderBaseUrl(normalizedProvider, baseUrl)
  const enabled = warnings.length === 0 && apiKey.length > 0 && resolvedModel.length > 0 && resolvedBaseUrl.length > 0

  return {
    provider: normalizedProvider,
    apiKey,
    model: resolvedModel,
    baseUrl,
    resolvedBaseUrl,
    enabled,
    warning: warnings.length > 0 ? `Some LLM provider settings are invalid: ${warnings.join("; ")}` : null,
    filePathDisplay: formatDisplayPath(filePath),
  }
}

export function createDefaultSnapshot(filePath: string, warning: string | null = null): LlmProviderSnapshot {
  return {
    provider: DEFAULT_PROVIDER,
    apiKey: "",
    model: DEFAULT_OPENAI_SDK_MODEL,
    baseUrl: "",
    resolvedBaseUrl: OPENAI_BASE_URL,
    enabled: false,
    warning,
    filePathDisplay: formatDisplayPath(filePath),
  }
}

function toSerializableValue(value: AnyValue): AnyValue {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    return value.map((entry: AnyValue) => toSerializableValue(entry))
  }
  if (value instanceof Error) {
    const errRecord: Record<string, AnyValue> = Object.fromEntries(
      Object.getOwnPropertyNames(value).map((key) => [key, Object.getOwnPropertyDescriptor(value, key)?.value])
    )
    return toSerializableValue(errRecord)
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).map((key) => [key, toSerializableValue(value[key])])
    )
  }
  return String(value)
}

export async function validateLlmProviderCredentials(
  value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">
): Promise<LlmProviderValidationResult> {
  const snapshot = normalizeLlmProviderSnapshot(value)
  if (!snapshot.enabled) {
    return {
      ok: false,
      error: {
        type: "config_error",
        message: snapshot.warning ?? "LLM provider configuration is incomplete.",
      },
    }
  }

  try {
    const client = new OpenAI({
      apiKey: snapshot.apiKey,
      baseURL: snapshot.resolvedBaseUrl,
    })
    await client.responses.create({
      model: snapshot.model,
      input: "Reply with ok.",
      max_output_tokens: 5,
    })
    return {
      ok: true,
      error: null,
    }
  } catch (error) {
    return {
      ok: false,
      error: toSerializableValue(error),
    }
  }
}
