
import type { AppSettingsPatch } from "../../shared/types"
import { isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../../shared/json"
import { isClaudeContextWindow, isClaudeReasoningEffort, isCodexReasoningEffort, type ClaudeModelOptions, type CodexModelOptions, type ProviderPreference } from "../../shared/provider-model-types"
import type { StoragePort } from "../ports/storagePort"

export function readPersistedZustandState(key: string, storage: StoragePort): JsonObject | null {
  const raw = storage.getItem(key)
  if (!raw) return null
  const parsed = safeJsonParse(raw)
  if (parsed === null || !isJsonObject(parsed)) return null
  return isJsonObject(parsed.state) ? parsed.state : null
}

export function decodeLegacyProviderDefaults(value: JsonValue): AppSettingsPatch["providerDefaults"] {
  if (!isJsonObject(value)) return undefined
  const decoded: NonNullable<AppSettingsPatch["providerDefaults"]> = {}

  if (isJsonObject(value.claude)) {
    const claude: Partial<ProviderPreference<ClaudeModelOptions>> = legacyPreferenceBase(value.claude)
    const options = value.claude.modelOptions
    if (isJsonObject(options)) {
      const reasoningEffort = stringOrUndefined(options.reasoningEffort)
      const contextWindow = stringOrUndefined(options.contextWindow)
      if (isClaudeReasoningEffort(reasoningEffort) && isClaudeContextWindow(contextWindow)) {
        claude.modelOptions = { reasoningEffort, contextWindow }
      }
    }
    decoded.claude = claude
  }

  if (isJsonObject(value.codex)) {
    const codex: Partial<ProviderPreference<CodexModelOptions>> = legacyPreferenceBase(value.codex)
    const options = value.codex.modelOptions
    if (isJsonObject(options)) {
      const reasoningEffort = stringOrUndefined(options.reasoningEffort)
      if (isCodexReasoningEffort(reasoningEffort) && typeof options.fastMode === "boolean") {
        codex.modelOptions = { reasoningEffort, fastMode: options.fastMode }
      }
    }
    decoded.codex = codex
  }

  if (isJsonObject(value.openrouter)) {
    decoded.openrouter = legacyPreferenceBase(value.openrouter)
  }

  return Object.keys(decoded).length > 0 ? decoded : undefined
}

function legacyPreferenceBase(value: JsonObject): { model?: string; planMode?: boolean } {
  const base: { model?: string; planMode?: boolean } = {}
  if (typeof value.model === "string") base.model = value.model
  if (typeof value.planMode === "boolean") base.planMode = value.planMode
  return base
}

function stringOrUndefined(value: JsonValue): string | undefined {
  return typeof value === "string" ? value : undefined
}
