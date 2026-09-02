import { isRecord } from "../errors"
import type { AnyValue } from "../errors"
import type { InstalledPackage } from "./types"

function asStringOrNull(value: AnyValue): string | null {
  return typeof value === "string" && value ? value : null
}

function asString(value: AnyValue): string {
  return typeof value === "string" ? value : ""
}

/**
 * Parse the output of `codex plugin list --json`.
 * Entries whose id starts with `.system` are Codex built-ins and are excluded.
 */
export function parseCodexPluginList(raw: AnyValue): { packages: InstalledPackage[]; error: string | null } {
  if (!Array.isArray(raw)) {
    return { packages: [], error: "codex plugin list: expected a JSON array" }
  }

  const packages: InstalledPackage[] = []

  for (const item of raw) {
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
    })
  }

  return { packages, error: null }
}
