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
 * Parse `~/.claude/plugins/installed_plugins.json` (v2 fallback).
 * This file lists all installed plugins regardless of scope; treated as user-scoped.
 */
export function parseClaudePluginsFile(raw: AnyValue): { packages: InstalledPackage[]; error: string | null } {
  if (!Array.isArray(raw)) {
    return { packages: [], error: "installed_plugins.json: expected a JSON array" }
  }

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
