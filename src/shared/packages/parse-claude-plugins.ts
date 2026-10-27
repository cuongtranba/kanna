import { isJsonObject, nonEmptyStringField, stringField, type JsonObject, type JsonValue } from "../json"
import { installedPackage } from "./installed-package"
import { parseClaudePluginName } from "./parse-claude-plugin-marketplace"
import type { InstalledPackage } from "./types"

function claudeVersionLabel(version: string | null): string | null {
  return version && version !== "unknown" ? version.slice(0, 12) : null
}

function claudePluginPackage(
  key: string,
  source: string,
  entry: JsonObject,
  revision: string | null,
): InstalledPackage {
  const version = nonEmptyStringField(entry, "version")
  return installedPackage("claude-plugin", key, {
    source,
    version,
    revision,
    installedAt: nonEmptyStringField(entry, "installedAt"),
    updatedAt: nonEmptyStringField(entry, "lastUpdated") ?? nonEmptyStringField(entry, "updatedAt"),
    installPath: nonEmptyStringField(entry, "installPath"),
    versionLabel: claudeVersionLabel(version),
  })
}

function isUserScoped(entry: JsonObject): boolean {
  return stringField(entry, "scope") === "user"
}

function collectClaudePluginsById(
  items: readonly JsonValue[],
  accept: (item: JsonObject) => boolean,
): InstalledPackage[] {
  const seen = new Set<string>()
  const packages: InstalledPackage[] = []

  for (const item of items) {
    if (!isJsonObject(item) || !accept(item)) continue
    const id = stringField(item, "id")
    if (!id || seen.has(id)) continue
    seen.add(id)
    packages.push(claudePluginPackage(id, id, item, null))
  }

  return packages
}

export function parseClaudePluginList(raw: JsonValue): { packages: InstalledPackage[]; error: string | null } {
  if (!Array.isArray(raw)) {
    return { packages: [], error: "claude plugin list: expected a JSON array" }
  }
  return { packages: collectClaudePluginsById(raw, isUserScoped), error: null }
}

export function parseClaudePluginsFile(raw: JsonValue): { packages: InstalledPackage[]; error: string | null } {
  if (isJsonObject(raw)) {
    return { packages: parseClaudePluginsFileV2(raw), error: null }
  }
  if (Array.isArray(raw)) {
    return { packages: collectClaudePluginsById(raw, () => true), error: null }
  }
  return { packages: [], error: "installed_plugins.json: expected an object or array" }
}

function parseClaudePluginsFileV2(raw: JsonObject): InstalledPackage[] {
  const packages: InstalledPackage[] = []

  for (const [pluginKey, scopedEntries] of Object.entries(raw)) {
    if (!pluginKey || !Array.isArray(scopedEntries)) continue

    const { plugin: pluginName, marketplace: marketplaceName } = parseClaudePluginName(pluginKey)
    if (!pluginName) continue

    const userEntry = scopedEntries.find((entry) => isJsonObject(entry) && isUserScoped(entry))
    if (userEntry === undefined || !isJsonObject(userEntry)) continue

    packages.push(
      claudePluginPackage(
        pluginKey,
        marketplaceName ?? pluginName,
        userEntry,
        nonEmptyStringField(userEntry, "gitCommitSha"),
      ),
    )
  }

  return packages
}
