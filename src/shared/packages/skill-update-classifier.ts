import type { InstalledPackage, PackageUpdateStatus } from "./types"

export interface GitTreeEntry {
  path: string
  type: "tree" | "blob" | "commit"
  sha: string
}

export interface UpstreamTreeIndex {
  byPath: ReadonlyMap<string, GitTreeEntry>
  byName: ReadonlyMap<string, GitTreeEntry>
}

export function resolveGitHubRepo(pkg: InstalledPackage): string | null {
  if (pkg.sourceUrl) {
    const match = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(\/.*)?$/.exec(pkg.sourceUrl)
    if (match) return match[1] ?? null
  }
  if (/^[^/]+\/[^/]+$/.test(pkg.source)) {
    return pkg.source
  }
  return null
}

export function deriveSkillFolder(skillPath: string): string | null {
  let folder = skillPath.trim()
  if (!folder) return null
  if (folder.endsWith("/SKILL.md")) folder = folder.slice(0, -"/SKILL.md".length)
  else if (folder === "SKILL.md") folder = ""
  if (folder.startsWith("./")) folder = folder.slice(2)
  while (folder.endsWith("/")) folder = folder.slice(0, -1)
  return folder || null
}

export function buildTreeIndex(entries: readonly GitTreeEntry[]): UpstreamTreeIndex {
  const byPath = new Map<string, GitTreeEntry>()
  const byName = new Map<string, GitTreeEntry>()
  for (const entry of entries) {
    if (entry.type !== "tree") continue
    byPath.set(entry.path, entry)
    const segments = entry.path.split("/")
    const baseName = segments.at(-1)
    if (!baseName) continue
    const existing = byName.get(baseName)
    if (!existing || segments.length < existing.path.split("/").length) {
      byName.set(baseName, entry)
    }
  }
  return { byPath, byName }
}

export function repinTarget(pkg: InstalledPackage, update: PackageUpdateStatus): string | null {
  if (!pkg.pinnedRef) return null
  const latest = update.latestVersion
  if (!latest || latest === pkg.pinnedRef) return null
  return latest
}

function findUpstreamEntry(index: UpstreamTreeIndex, pkg: InstalledPackage): GitTreeEntry | null {
  const folder = pkg.installPath ? deriveSkillFolder(pkg.installPath) : null
  if (folder) return index.byPath.get(folder) ?? null
  return index.byName.get(pkg.name) ?? null
}

export function classifySkillUpdate(
  index: UpstreamTreeIndex,
  truncated: boolean,
  pkg: InstalledPackage,
  checkedAt: number,
): PackageUpdateStatus {
  const base: Omit<PackageUpdateStatus, "availability" | "error"> = {
    id: pkg.id,
    currentRevision: pkg.revision,
    latestRevision: null,
    currentVersion: pkg.pinnedRef,
    latestVersion: null,
    checkedAt,
  }

  const repo = resolveGitHubRepo(pkg)
  if (!repo) {
    return { ...base, availability: "unknown", error: "unsupported source" }
  }

  if (!pkg.revision) {
    return { ...base, availability: "unknown", error: "no folder hash in lock (lock v1 not supported)" }
  }

  const entry = findUpstreamEntry(index, pkg)

  if (!entry) {
    if (truncated) {
      return { ...base, availability: "unknown", error: "tree truncated" }
    }
    return { ...base, availability: "outdated", error: null }
  }

  if (entry.type !== "tree") {
    return { ...base, availability: "unknown", error: `unexpected entry type: ${entry.type}` }
  }

  const latestRevision = entry.sha
  if (latestRevision === pkg.revision) {
    return { ...base, latestRevision, availability: "up_to_date", error: null }
  }

  return { ...base, latestRevision, availability: "outdated", error: null }
}
