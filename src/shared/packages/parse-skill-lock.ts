import { isJsonObject, type JsonValue } from "../json"
import type { InstalledPackage } from "./types"

function asStringOrNull(value: JsonValue): string | null {
  return typeof value === "string" && value ? value : null
}

function asString(value: JsonValue): string {
  return typeof value === "string" ? value : ""
}

export function parseSkillLock(
  raw: JsonValue,
  agentPresenceMap: ReadonlyMap<string, string[]>,
): { packages: InstalledPackage[]; error: string | null } {
  if (!isJsonObject(raw)) {
    return { packages: [], error: "skill lock: not an object" }
  }

  const version = raw.version
  if (version === 1) {
    return { packages: [], error: "skill lock: v1 format is not supported (upgrade the skills CLI)" }
  }
  if (version !== 3) {
    return { packages: [], error: `skill lock: unknown version ${String(version)}` }
  }

  const skillsRaw = isJsonObject(raw.skills) && !Array.isArray(raw.skills) ? raw.skills : null
  if (!skillsRaw) {
    return { packages: [], error: null }
  }

  const packages: InstalledPackage[] = []
  for (const [name, entry] of Object.entries(skillsRaw)) {
    if (!isJsonObject(entry)) continue

    const source = asString(entry.source)
    const sourceUrl = asStringOrNull(entry.sourceUrl)
    const installPath = asStringOrNull(entry.skillPath)
    const revision = asStringOrNull(entry.skillFolderHash)
    const installedAt = asStringOrNull(entry.installedAt)
    const updatedAt = asStringOrNull(entry.updatedAt)
    const pinnedRef = asStringOrNull(entry.ref)

    packages.push({
      id: `skill:${name}`,
      kind: "skill",
      name,
      source,
      sourceUrl,
      version: null,
      revision,
      installedAt,
      updatedAt,
      installPath,
      versionLabel: revision ? revision.slice(0, 8) : null,
      agents: agentPresenceMap.get(name) ?? [],
      pinnedRef,
    })
  }

  packages.sort((a, b) => a.name.localeCompare(b.name))
  return { packages, error: null }
}
