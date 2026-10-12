import {
  CUSTOM_PROVIDER_ID_REGEX,
  validateCustomProviderShape,
  type CustomProviderInput,
  type CustomProviderModel,
  type CustomProviderPatch,
  type CustomProviderPublic,
} from "../../shared/custom-providers"
import type { CustomProviderPreset } from "../../shared/custom-provider-presets"

export interface CustomProviderDraft {
  id: string
  idTouched: boolean
  label: string
  baseUrl: string
  apiKey: string
  models: CustomProviderModel[]
  hint: string | null
}

const ID_MAX_LENGTH = 32
const KEEP_STORED_KEY_PLACEHOLDER = "-"

export function emptyCustomProviderDraft(): CustomProviderDraft {
  return {
    id: "",
    idTouched: false,
    label: "",
    baseUrl: "",
    apiKey: "",
    models: [{ id: "", label: "" }],
    hint: null,
  }
}

export function slugifyProviderId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, ID_MAX_LENGTH)
    .replace(/-+$/, "")
}

export function freeProviderId(base: string, takenIds: readonly string[]): string {
  if (base.length === 0 || !takenIds.includes(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`
    const candidate = `${base.slice(0, ID_MAX_LENGTH - tail.length)}${tail}`
    if (!takenIds.includes(candidate)) return candidate
  }
}

export function draftFromPreset(preset: CustomProviderPreset, takenIds: readonly string[]): CustomProviderDraft {
  return {
    id: freeProviderId(preset.id, takenIds),
    idTouched: true,
    label: preset.label,
    baseUrl: preset.baseUrl,
    apiKey: "",
    models: preset.models.map((model) => ({ ...model })),
    hint: preset.hint ?? null,
  }
}

export function draftFromProvider(provider: CustomProviderPublic): CustomProviderDraft {
  return {
    id: provider.id,
    idTouched: true,
    label: provider.label,
    baseUrl: provider.baseUrl,
    apiKey: "",
    models: provider.models.map((model) => ({ ...model })),
    hint: null,
  }
}

export function deriveDraftId(label: string, takenIds: readonly string[]): string {
  return freeProviderId(slugifyProviderId(label), takenIds)
}

function cleanedModels(models: readonly CustomProviderModel[]): CustomProviderModel[] {
  return models
    .map((model) => ({ id: model.id.trim(), label: model.label.trim() }))
    .filter((model) => model.id.length > 0 || model.label.length > 0)
}

export function buildCreateInput(draft: CustomProviderDraft): CustomProviderInput {
  return {
    id: draft.id.trim(),
    label: draft.label.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim(),
    models: cleanedModels(draft.models),
  }
}

export function buildUpdatePatch(draft: CustomProviderDraft): CustomProviderPatch {
  const apiKey = draft.apiKey.trim()
  return {
    label: draft.label.trim(),
    baseUrl: draft.baseUrl.trim(),
    models: cleanedModels(draft.models),
    ...(apiKey.length > 0 ? { apiKey } : {}),
  }
}

export function validateDraft(
  draft: CustomProviderDraft,
  mode: "create" | "edit",
  otherIds: readonly string[],
): string | null {
  const input = buildCreateInput(draft)
  const error = validateCustomProviderShape(
    {
      ...input,
      apiKey: mode === "edit" && input.apiKey.length === 0 ? KEEP_STORED_KEY_PLACEHOLDER : input.apiKey,
    },
    otherIds,
  )
  if (error === null) return null
  return error.code === "INVALID_ID"
    ? `Id must be lowercase letters, digits or dashes, start with a letter, and be at most ${ID_MAX_LENGTH} characters (${CUSTOM_PROVIDER_ID_REGEX}).`
    : error.message
}

export function keyStatusLabel(apiKeyHint: string | null): string {
  return apiKeyHint === null ? "Key set" : `Key ••••${apiKeyHint}`
}

export function keyPlaceholder(mode: "create" | "edit", apiKeyHint: string | null): string {
  if (mode === "create") return "API key"
  return apiKeyHint === null ? "Leave blank to keep the saved key" : `Leave blank to keep ••••${apiKeyHint}`
}
