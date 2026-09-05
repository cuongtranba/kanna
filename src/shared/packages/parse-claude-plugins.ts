import { isJsonObject, type JsonObject, type JsonValue } from "../json"
import type { InstalledPackage } from "./types"

function asStringOrNull(value: JsonValue): string | null {
  return typeof value === "string" && value ? value : null
}

function asString(value: JsonValue): string {
  return typeof value === "string" ? value : ""
}

function buildClaudePluginPackage(entry: JsonObject): InstalledPackage | null {
  const id = asString(entry.id)
  if (!id) return null

  const version = asStringOrNull(entry.version)
  const installPath = asStringOrNull(entry.installPath)
  const installedAt = asStringOrNull(entry.installedAt)
  const updatedAt = asStringOrNull(entry.lastUpdated) ?? asStringOrNull(entry.updatedAt)

  return {
    id: `claude-plugin:${id}`,
    kind: "claude-plugin",
    name: id,
    source: id,
    sourceUrl: null,
    version,
    revision: null,
    installedAt,
    updatedAt,
    installPath,
    versionLabel: version && version !== "unknown" ? version.slice(0, 12) : null,
    agents: [],
    pinnedRef: null,
  }
}

export function parseClaudePluginList(raw: JsonValue): { packages: InstalledPackage[]; error: string | null } {
  if (!Array.isArray(raw)) {
    return { packages: [], error: "claude plugin list: expected a JSON array" }
  }

  const seen = new Set<string>()
  const packages: InstalledPackage[] = []

  for (const item of raw) {
    if (!isJsonObject(item)) continue
    if (asString(item.scope) !== "user") continue

    const id = asString(item.id)
    if (!id || seen.has(id)) continue
    seen.add(id)

    const pkg = buildClaudePluginPackage(item)
    if (pkg) packages.push(pkg)
  }

  return { packages, error: null }
}

export function parseClaudePluginsFile(raw: JsonValue): { packages: InstalledPackage[]; error: string | null } {
  if (isJsonObject(raw)) {
    return parseClaudePluginsFileV2(raw)
  }
  if (Array.isArray(raw)) {
    return parseClaudePluginsFileV1(raw)
  }
  return { packages: [], error: "installed_plugins.json: expected an object or array" }
}

function parseClaudePluginsFileV2(raw: JsonObject): {
  packages: InstalledPackage[]
  error: string | null
} {
  const seen = new Set<string>()
  const packages: InstalledPackage[] = []

  for (const [pluginKey, scopedEntries] of Object.entries(raw)) {
    if (!pluginKey || !Array.isArray(scopedEntries)) continue

    const atIdx = pluginKey.indexOf("@")
    const pluginName = atIdx >= 0 ? pluginKey.slice(0, atIdx) : pluginKey
    const marketplaceName = atIdx >= 0 ? pluginKey.slice(atIdx + 1) : null

    if (!pluginName || seen.has(pluginKey)) continue
    seen.add(pluginKey)

    let userEntry: JsonObject | null = null
    for (const entry of scopedEntries) {
      if (isJsonObject(entry) && asString(entry.scope) === "user") {
        userEntry = entry
        break
      }
    }
    if (!userEntry) continue

    const version = asStringOrNull(userEntry.version)
    const installPath = asStringOrNull(userEntry.installPath)
    const installedAt = asStringOrNull(userEntry.installedAt)
    const updatedAt = asStringOrNull(userEntry.lastUpdated) ?? asStringOrNull(userEntry.updatedAt)
    const revision = asStringOrNull(userEntry.gitCommitSha)

    packages.push({
      id: `claude-plugin:${pluginKey}`,
      kind: "claude-plugin",
      name: pluginKey,
      source: marketplaceName ?? pluginName,
      sourceUrl: null,
      version,
      revision,
      installedAt,
      updatedAt,
      installPath,
      versionLabel: version && version !== "unknown" ? version.slice(0, 12) : null,
      agents: [],
      pinnedRef: null,
    })
  }

  return { packages, error: null }
}

function parseClaudePluginsFileV1(raw: JsonValue[]): { packages: InstalledPackage[]; error: string | null } {
  const seen = new Set<string>()
  const packages: InstalledPackage[] = []

  for (const item of raw) {
    if (!isJsonObject(item)) continue

    const id = asString(item.id)
    if (!id || seen.has(id)) continue
    seen.add(id)

    const pkg = buildClaudePluginPackage(item)
    if (pkg) packages.push(pkg)
  }

  return { packages, error: null }
}
