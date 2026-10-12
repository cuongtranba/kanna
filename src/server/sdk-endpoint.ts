import { parseCustomModelId, type CustomProviderCredential } from "../shared/custom-providers"
import { OPENROUTER_BASE_URL } from "../shared/provider-model-types"
import type { AgentProvider } from "../shared/types"

export type SdkEndpointKey = "openrouter" | `custom:${string}`
export type SessionEndpointKey = "anthropic" | SdkEndpointKey

export const ANTHROPIC_ENDPOINT_KEY = "anthropic" satisfies SessionEndpointKey

export interface SdkEndpoint {
  key: SdkEndpointKey
  label: string
  baseUrl: string
  apiKey: string
  vendorModel: string
  aliasModel: string | null
  contextWindow: number | null
}

export type SdkEndpointEnv = Pick<SdkEndpoint, "baseUrl" | "apiKey" | "aliasModel" | "contextWindow">

export function endpointEnvOf(endpoint: SdkEndpoint | null): SdkEndpointEnv | null {
  if (!endpoint) return null
  const { baseUrl, apiKey, aliasModel, contextWindow } = endpoint
  return { baseUrl, apiKey, aliasModel, contextWindow }
}

export interface SdkEndpointSource {
  readLlmProvider: () => Promise<{ apiKey: string }>
  getCustomProviderCredential: (id: string) => CustomProviderCredential | null
}

export function endpointKeyOf(endpoint: SdkEndpoint | null): SessionEndpointKey {
  return endpoint ? endpoint.key : ANTHROPIC_ENDPOINT_KEY
}

export function endpointSpawnFingerprint(endpoint: SdkEndpoint | null): string {
  if (!endpoint) return ANTHROPIC_ENDPOINT_KEY
  return JSON.stringify([endpoint.key, endpoint.baseUrl, endpoint.apiKey, endpoint.aliasModel, endpoint.contextWindow])
}

export async function resolveSdkEndpoint(
  provider: AgentProvider,
  model: string,
  deps: SdkEndpointSource,
): Promise<SdkEndpoint | null> {
  if (provider === "openrouter") {
    const { apiKey } = await deps.readLlmProvider()
    return { key: "openrouter", label: "OpenRouter", baseUrl: OPENROUTER_BASE_URL, apiKey, vendorModel: model, aliasModel: null, contextWindow: null }
  }
  if (provider !== "custom") return null
  const parsed = parseCustomModelId(model)
  if (!parsed) {
    throw new Error(`Model '${model}' is not a custom endpoint model — pick a model from Settings → Custom endpoints`)
  }
  const credential = deps.getCustomProviderCredential(parsed.providerId)
  if (!credential) {
    throw new Error(`Custom provider '${parsed.providerId}' was removed — pick another model`)
  }
  if (credential.apiKey.length === 0) {
    throw new Error(`Custom provider '${credential.label}' has no API key — add one in Settings → Custom endpoints`)
  }
  return {
    key: `custom:${parsed.providerId}`,
    label: credential.label,
    baseUrl: credential.baseUrl,
    apiKey: credential.apiKey,
    vendorModel: parsed.vendorModel,
    aliasModel: parsed.vendorModel,
    contextWindow: credential.contextWindow,
  }
}
