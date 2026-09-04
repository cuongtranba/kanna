import { isRecord } from "../errors"
import type { AnyValue } from "../errors"
import type { InstalledPackage } from "./types"

function asStringOrNull(value: AnyValue): string | null {
  return typeof value === "string" && value ? value : null
}

function asString(value: AnyValue): string {
  return typeof value === "string" ? value : ""
}

/** Entry from the `available` array — a plugin that has an update. */
export interface CodexPluginAvailableEntry {
  id: string
  version: string | null
}

function parseInstalledArray(
  arr: AnyValue[],
): InstalledPackage[] {
  const packages: InstalledPackage[] = []

  for (const item of arr) {
    if (!isRecord(item)) continue

    const id = asString(item.id)
    if (!id) continue
    if (id.startsWith(".system")) continue

    const version = asStringOrNull(item.version)
    const installPath = asStringOrNull(item.installPath)
    const installedAt = asStringOrNull(item.installedAt)
    const updatedAt = asStringOrNull(item.updatedAt)

    packages.push({
      id: `codex-plugin:${id}`,
      kind: "codex-plugin",
      name: id,
      source: id,
      sourceUrl: null,
      version,
      revision: null,
      installedAt,
      updatedAt,
      installPath,
      versionLabel: version ?? null,
      agents: [],
      pinnedRef: null,
    })
  }

  return packages
}

/**
 * Parse the output of `codex plugin list --json`.
 *
 * The real CLI output is `{ installed: [...], available: [...] }`. Entries
 * whose `id` starts with `.system` are Codex built-ins and are excluded.
 */
export function parseCodexPluginList(raw: AnyValue): { packages: InstalledPackage[]; error: string | null } {
  if (!isRecord(raw)) {
    return { packages: [], error: "codex plugin list: expected a JSON object" }
  }

  const installed = raw.installed
  if (!Array.isArray(installed)) {
    return { packages: [], error: "codex plugin list: missing 'installed' array" }
  }

  return { packages: parseInstalledArray(installed), error: null }
}

/**
 * Parse the `available` array from `codex plugin list --json`.
 *
 * Returns a map of plugin id → latest available version. An entry in
 * `available` means the plugin has an update relative to what is installed.
 */
export function parseCodexPluginAvailable(raw: AnyValue): Map<string, CodexPluginAvailableEntry> {
  const result = new Map<string, CodexPluginAvailableEntry>()
  if (!isRecord(raw)) return result

  const available = raw.available
  if (!Array.isArray(available)) return result

  for (const item of available) {
    if (!isRecord(item)) continue
    const id = asString(item.id)
    if (!id) continue
    if (id.startsWith(".system")) continue
    result.set(id, { id, version: asStringOrNull(item.version) })
  }

  return result
}
