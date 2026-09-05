import { isRecord } from "../../shared/errors"
import { isValidPluginId } from "../../shared/plugins/manifest"
import type { InstalledPluginConfig, PluginSettings } from "../../shared/plugins/settings"
import { PLUGIN_SETTINGS_DEFAULTS } from "../../shared/plugins/settings"

export interface InstalledPluginCreateInput {
  readonly sourceDir: string
  readonly id: string
}

export interface InstalledPluginPatch {
  readonly enabled?: boolean
}

export interface InstalledPluginsPatch {
  readonly create?: InstalledPluginCreateInput
  readonly update?: { readonly id: string; readonly patch: InstalledPluginPatch }
  readonly delete?: { readonly id: string }
}

export class PluginSettingsValidationException extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PluginSettingsValidationException"
  }
}

function createInstalledPlugin(
  input: InstalledPluginCreateInput,
  current: readonly InstalledPluginConfig[],
): InstalledPluginConfig {
  if (!isValidPluginId(input.id)) {
    throw new PluginSettingsValidationException(`Plugin id "${input.id}" is invalid or reserved`)
  }
  if (current.some((entry) => entry.id === input.id)) {
    throw new PluginSettingsValidationException(`Plugin "${input.id}" is already installed`)
  }
  return { id: input.id, sourceDir: input.sourceDir, enabled: false }
}

export function applyAppSettingsPatchForTest(
  current: readonly InstalledPluginConfig[],
  patch: InstalledPluginsPatch | undefined,
): InstalledPluginConfig[] {
  if (patch?.create) return [...current, createInstalledPlugin(patch.create, current)]
  if (patch?.update) {
    const { id, patch: entryPatch } = patch.update
    const index = current.findIndex((entry) => entry.id === id)
    if (index < 0) throw new PluginSettingsValidationException(`Plugin "${id}" not found`)
    const updated = { ...current[index]!, ...entryPatch }
    return [...current.slice(0, index), updated, ...current.slice(index + 1)]
  }
  if (patch?.delete) {
    const removedId = patch.delete.id
    return current.filter((entry) => entry.id !== removedId)
  }
  return [...current]
}

function normalizeInstalledPluginEntry<T>(value: T, warnings: string[]): InstalledPluginConfig | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === "string" ? value.id : null
  const sourceDir = typeof value.sourceDir === "string" ? value.sourceDir : null
  if (!id || !sourceDir) {
    warnings.push("installedPlugins entry rejected: missing id/sourceDir")
    return null
  }
  if (!isValidPluginId(id)) {
    warnings.push(`installedPlugins entry '${id}' rejected: invalid or reserved id`)
    return null
  }
  return { id, sourceDir, enabled: value.enabled === true }
}

export function normalizeInstalledPlugins<T>(value: T, warnings: string[]): InstalledPluginConfig[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    warnings.push("installedPlugins must be an array")
    return []
  }
  const out: InstalledPluginConfig[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const normalized = normalizeInstalledPluginEntry(entry, warnings)
    if (!normalized) continue
    if (seen.has(normalized.id)) {
      warnings.push(`installedPlugins entry '${normalized.id}' rejected: duplicate id`)
      continue
    }
    seen.add(normalized.id)
    out.push(normalized)
  }
  return out
}

export function normalizePluginSettings<T>(value: T, warnings: string[]): PluginSettings {
  if (value === undefined) return { ...PLUGIN_SETTINGS_DEFAULTS }
  if (!isRecord(value)) {
    warnings.push("plugins must be an object")
    return { ...PLUGIN_SETTINGS_DEFAULTS }
  }
  return { enabled: value.enabled === true }
}

export function normalizePluginState<T>(
  source: T,
  warnings: string[],
): { plugins: PluginSettings; installedPlugins: InstalledPluginConfig[] } {
  const src = isRecord(source) ? source : undefined
  return {
    plugins: normalizePluginSettings(src?.plugins, warnings),
    installedPlugins: normalizeInstalledPlugins(src?.installedPlugins, warnings),
  }
}

export function mergePluginPatch(
  state: { plugins: PluginSettings; installedPlugins: readonly InstalledPluginConfig[] },
  patch: { plugins?: Partial<PluginSettings>; installedPlugins?: InstalledPluginsPatch },
): { plugins: PluginSettings; installedPlugins: InstalledPluginConfig[] } {
  return {
    plugins: { ...state.plugins, ...patch.plugins },
    installedPlugins: patch.installedPlugins
      ? applyAppSettingsPatchForTest(state.installedPlugins, patch.installedPlugins)
      : [...state.installedPlugins],
  }
}
