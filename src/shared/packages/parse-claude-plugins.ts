import { isRecord } from "../errors"
import type { AnyValue } from "../errors"
import type { InstalledPackage } from "./types"

function asStringOrNull(value: AnyValue): string | null {
  return typeof value === "string" && value ? value : null
}

function asString(value: AnyValue): string {
  return typeof value === "string" ? value : ""
}

function buildClaudePluginPackage(entry: Record<string, AnyValue>): InstalledPackage | null {
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

/**
 * Parse the output of `claude plugin list --json`.
 * Only user-scoped entries are included; duplicates (same id) are deduplicated
 * by taking the first occurrence.
 */
export function parseClaudePluginList(raw: AnyValue): { packages: InstalledPackage[]; error: string | null } {
  if (!Array.isArray(raw)) {
    return { packages: [], error: "claude plugin list: expected a JSON array" }
  }

  const seen = new Set<string>()
  const packages: InstalledPackage[] = []

  for (const item of raw) {
    if (!isRecord(item)) continue
    if (asString(item.scope) !== "user") continue

    const id = asString(item.id)
    if (!id || seen.has(id)) continue
    seen.add(id)

    const pkg = buildClaudePluginPackage(item)
    if (pkg) packages.push(pkg)
  }

  return { packages, error: null }
}

/**
 * Parse `~/.claude/plugins/installed_plugins.json`.
 *
 * v2 format (dict): keys are `pluginId@marketplaceName`, values are arrays of
 * scoped entries. Only the user-scoped entry per key is included; gitCommitSha
 * is stored in `revision` for update comparison.
 *
 * v1 format (array): each item is a flat entry; treated as user-scoped. Kept
 * as a fallback for older installations.
 */
export function parseClaudePluginsFile(raw: AnyValue): { packages: InstalledPackage[]; error: string | null } {
  if (isRecord(raw)) {
    return parseClaudePluginsFileV2(raw)
  }
  if (Array.isArray(raw)) {
    return parseClaudePluginsFileV1(raw)
  }
  return { packages: [], error: "installed_plugins.json: expected an object or array" }
}

function parseClaudePluginsFileV2(raw: Record<string, AnyValue>): {
  packages: InstalledPackage[]
  error: string | null
} {
  const seen = new Set<string>()
  const packages: InstalledPackage[] = []

  for (const [pluginKey, scopedEntries] of Object.entries(raw)) {
    if (!pluginKey || !Array.isArray(scopedEntries)) continue

    // Extract marketplace name from `pluginName@marketplaceName` key format.
    const atIdx = pluginKey.indexOf("@")
    const pluginName = atIdx >= 0 ? pluginKey.slice(0, atIdx) : pluginKey
    const marketplaceName = atIdx >= 0 ? pluginKey.slice(atIdx + 1) : null

    if (!pluginName || seen.has(pluginKey)) continue
    seen.add(pluginKey)

    // Take the first user-scoped entry for this plugin.
    let userEntry: Record<string, AnyValue> | null = null
    for (const entry of scopedEntries) {
      if (isRecord(entry) && asString(entry.scope) === "user") {
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

function parseClaudePluginsFileV1(raw: AnyValue[]): { packages: InstalledPackage[]; error: string | null } {
  const seen = new Set<string>()
  const packages: InstalledPackage[] = []

  for (const item of raw) {
    if (!isRecord(item)) continue

    const id = asString(item.id)
    if (!id || seen.has(id)) continue
    seen.add(id)

    const pkg = buildClaudePluginPackage(item)
    if (pkg) packages.push(pkg)
  }

  return { packages, error: null }
}
