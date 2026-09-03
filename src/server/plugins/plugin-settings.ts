/**
 * Pure create/update/delete reducer for the installed-plugins settings
 * collection. Mirrors the locate-then-splice/filter shape of
 * `app-settings.ts`'s `applyCollectionPatch` (the same idiom MCP servers and
 * subagents use), kept in its own module so:
 *
 * 1. `app-settings.ts` — already near a documented size ceiling
 *    (`src/ops/architecture/budget.ts`) — only needs a couple of lines to
 *    wire this in, rather than inlining another collection's mechanics.
 * 2. The acceptance oracle can drive the reducer directly, with no
 *    `AppSettingsManager` in the loop.
 *
 * This collection is simpler than MCP servers or subagents: no extra arms
 * beyond create/update/delete, and `id` is supplied by the caller (it comes
 * from the plugin's own manifest) rather than minted here.
 */
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

/**
 * The create/update/delete mechanics for the installed-plugins collection —
 * append, locate-then-splice, filter, all producing a new array. Returns
 * `undefined` when the patch names none of the three arms, so a caller can
 * fall back to the previous collection unchanged (same contract as
 * `app-settings.ts`'s generic `applyCollectionPatch`).
 *
 * Named to match the acceptance oracle's call shape
 * (`src/server/plugin-system-acceptance.test.tsx`), which drives it
 * directly with no `AppSettingsManager` involved; `AppSettingsManager.applyPatch`
 * (`src/server/app-settings.ts`) calls this same function for real writes.
 */
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

/** Reads one installed-plugin entry out of a raw settings-file value. */
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

/** Normalizes the persisted `installedPlugins` array read from settings.json. */
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

/** Normalizes the persisted `plugins` (global switch) object read from settings.json. */
export function normalizePluginSettings<T>(value: T, warnings: string[]): PluginSettings {
  if (value === undefined) return { ...PLUGIN_SETTINGS_DEFAULTS }
  if (!isRecord(value)) {
    warnings.push("plugins must be an object")
    return { ...PLUGIN_SETTINGS_DEFAULTS }
  }
  return { enabled: value.enabled === true }
}

/**
 * The plugin slice of `AppSettingsSnapshot`, normalized in one call.
 *
 * Exists so `app-settings.ts` spends two lines on this feature instead of
 * eight. That file is a listed oversized module sitting EXACTLY on its
 * architecture-budget ceiling, so every line a feature adds there has to be
 * paid for by shrinking something else — the plugin system owns its own
 * settings shape, so it owns the normalization and the patch merge too.
 */
export function normalizePluginState<T>(
  source: T,
  warnings: string[],
): { plugins: PluginSettings; installedPlugins: InstalledPluginConfig[] } {
  // Generic + `isRecord` rather than an `unknown`-typed parameter: this repo
  // bans the `unknown` keyword outside `toError`.
  const src = isRecord(source) ? source : undefined
  return {
    plugins: normalizePluginSettings(src?.plugins, warnings),
    installedPlugins: normalizeInstalledPlugins(src?.installedPlugins, warnings),
  }
}

/** Fold an `AppSettingsPatch`'s plugin arms over current state. Counterpart of `normalizePluginState`. */
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
