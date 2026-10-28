import { isJsonObject, nonEmptyStringField, objectField, stringField, type JsonValue } from "../json"
import { installedPackage } from "./installed-package"
import type { InstalledPackage } from "./types"

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

  const skillsRaw = objectField(raw, "skills")
  if (!skillsRaw) {
    return { packages: [], error: null }
  }

  const packages: InstalledPackage[] = []
  for (const [name, entry] of Object.entries(skillsRaw)) {
    if (!isJsonObject(entry)) continue

    const revision = nonEmptyStringField(entry, "skillFolderHash")
    packages.push(
      installedPackage("skill", name, {
        source: stringField(entry, "source") ?? "",
        sourceUrl: nonEmptyStringField(entry, "sourceUrl"),
        version: null,
        revision,
        installedAt: nonEmptyStringField(entry, "installedAt"),
        updatedAt: nonEmptyStringField(entry, "updatedAt"),
        installPath: nonEmptyStringField(entry, "skillPath"),
        versionLabel: revision ? revision.slice(0, 8) : null,
        agents: agentPresenceMap.get(name) ?? [],
        pinnedRef: nonEmptyStringField(entry, "ref"),
      }),
    )
  }

  packages.sort((a, b) => a.name.localeCompare(b.name))
  return { packages, error: null }
}
