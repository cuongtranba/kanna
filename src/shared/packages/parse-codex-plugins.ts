import { isJsonObject, type JsonValue } from "../json"
import type { InstalledPackage } from "./types"

function asStringOrNull(value: JsonValue): string | null {
  return typeof value === "string" && value ? value : null
}

function asString(value: JsonValue): string {
  return typeof value === "string" ? value : ""
}

export interface CodexPluginAvailableEntry {
  id: string
  version: string | null
}

function parseInstalledArray(
  arr: JsonValue[],
): InstalledPackage[] {
  const packages: InstalledPackage[] = []

  for (const item of arr) {
    if (!isJsonObject(item)) continue

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

export function parseCodexPluginList(raw: JsonValue): { packages: InstalledPackage[]; error: string | null } {
  if (!isJsonObject(raw)) {
    return { packages: [], error: "codex plugin list: expected a JSON object" }
  }

  const installed = raw.installed
  if (!Array.isArray(installed)) {
    return { packages: [], error: "codex plugin list: missing 'installed' array" }
  }

  return { packages: parseInstalledArray(installed), error: null }
}

export function parseCodexPluginAvailable(raw: JsonValue): Map<string, CodexPluginAvailableEntry> {
  const result = new Map<string, CodexPluginAvailableEntry>()
  if (!isJsonObject(raw)) return result

  const available = raw.available
  if (!Array.isArray(available)) return result

  for (const item of available) {
    if (!isJsonObject(item)) continue
    const id = asString(item.id)
    if (!id) continue
    if (id.startsWith(".system")) continue
    result.set(id, { id, version: asStringOrNull(item.version) })
  }

  return result
}
