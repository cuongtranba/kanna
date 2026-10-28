import { homedir } from "node:os"
import OpenAI from "openai"
import { isJsonObject, type JsonValue } from "../shared/json"
import { getLlmProviderFilePath } from "../shared/branding"
import { shortenHomePath } from "../shared/home-path"
import { toJsonValue } from "./json-boundary"
import { readJsonSettingsFile, writeJsonSettingsFile } from "./json-settings-file.adapter"
import {
  DEFAULT_OPENAI_SDK_MODEL,
  DEFAULT_OPENROUTER_SDK_MODEL,
  type LlmProviderFile,
  type LlmProviderKind,
  type LlmProviderSnapshot,
  type LlmProviderValidationResult,
} from "../shared/types"


export const OPENAI_BASE_URL = "https://api.openai.com/v1"
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

const DEFAULT_PROVIDER: LlmProviderKind = "openai"

function resolveProvider(value: JsonValue | undefined) {
  if (value === "openai" || value === "openrouter" || value === "custom") {
    return value
  }
  return null
}

function normalizeString(value: JsonValue | undefined) {
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
  value: JsonValue | undefined,
  filePath = getLlmProviderFilePath(homedir())
): LlmProviderSnapshot {
  const source = value !== undefined && isJsonObject(value) ? value : null
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
    filePathDisplay: shortenHomePath(filePath, homedir()),
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
    filePathDisplay: shortenHomePath(filePath, homedir()),
  }
}

export function readLlmProviderSnapshot(filePath = getLlmProviderFilePath(homedir())): Promise<LlmProviderSnapshot> {
  return readJsonSettingsFile(filePath, {
    label: "LLM provider",
    defaults: (warning) => createDefaultSnapshot(filePath, warning),
    normalize: (value) => normalizeLlmProviderSnapshot(value, filePath),
  })
}

export async function writeLlmProviderSnapshot(
  value: Pick<LlmProviderFile, "provider" | "apiKey" | "model"> & { baseUrl: string },
  filePath = getLlmProviderFilePath(homedir()),
): Promise<LlmProviderSnapshot> {
  const snapshot = normalizeLlmProviderSnapshot(value, filePath)
  await writeJsonSettingsFile(filePath, {
    provider: snapshot.provider,
    apiKey: snapshot.apiKey,
    model: snapshot.model,
    baseUrl: snapshot.provider === "custom" ? snapshot.baseUrl : null,
  })
  return snapshot
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
      error: toJsonValue(error),
    }
  }
}
