import { isJsonObject, nonEmptyStringField, stringField, type JsonValue } from "../json"
import { installedPackage } from "./installed-package"
import type { InstalledPackage } from "./types"

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

    const id = stringField(item, "id")
    if (!id) continue
    if (id.startsWith(".system")) continue

    const version = nonEmptyStringField(item, "version")
    packages.push(
      installedPackage("codex-plugin", id, {
        source: id,
        version,
        installedAt: nonEmptyStringField(item, "installedAt"),
        updatedAt: nonEmptyStringField(item, "updatedAt"),
        installPath: nonEmptyStringField(item, "installPath"),
        versionLabel: version,
      }),
    )
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
    const id = stringField(item, "id")
    if (!id) continue
    if (id.startsWith(".system")) continue
    result.set(id, { id, version: nonEmptyStringField(item, "version") })
  }

  return result
}
