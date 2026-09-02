import type { InstalledPackage, PackageUpdateStatus } from "./types"

export interface GitTreeEntry {
  path: string
  type: "tree" | "blob" | "commit"
  sha: string
}

/**
 * Resolve the GitHub `owner/repo` identifier from an InstalledPackage.
 * Returns null if the source is not GitHub.
 */
export function resolveGitHubRepo(pkg: InstalledPackage): string | null {
  // Try sourceUrl first: https://github.com/owner/repo[.git][/...]
  if (pkg.sourceUrl) {
    const match = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(\/.*)?$/.exec(pkg.sourceUrl)
    if (match) return match[1] ?? null
  }
  // Try source field: must be exactly `owner/repo` (one slash, no leading slash)
  if (/^[^/]+\/[^/]+$/.test(pkg.source)) {
    return pkg.source
  }
  return null
}

/**
 * Build a lookup map from skill folder base-name to the shallowest matching
 * `type:"tree"` entry in a GitHub recursive tree response.
 */
export function buildEntryMap(entries: GitTreeEntry[]): Map<string, GitTreeEntry> {
  const map = new Map<string, GitTreeEntry>()
  for (const entry of entries) {
    if (entry.type !== "tree") continue
    const segments = entry.path.split("/")
    const baseName = segments.at(-1)
    if (!baseName) continue
    const existing = map.get(baseName)
    if (!existing) {
      map.set(baseName, entry)
    } else if (segments.length < existing.path.split("/").length) {
      // Keep the shallowest (fewest path segments)
      map.set(baseName, entry)
    }
  }
  return map
}

/**
 * Pure classifier: compares a skill's installed folder hash against the
 * upstream tree entry found in `entryMap`.
 *
 * @param entryMap - Map<folderBaseName, GitTreeEntry> for the repo
 * @param truncated - whether the GitHub tree response was truncated
 * @param pkg - the installed package to classify
 * @param checkedAt - timestamp (Date.now()) for the status
 */
export function classifySkillUpdate(
  entryMap: Map<string, GitTreeEntry>,
  truncated: boolean,
  pkg: InstalledPackage,
  checkedAt: number,
): PackageUpdateStatus {
  const base: Omit<PackageUpdateStatus, "availability" | "error"> = {
    id: pkg.id,
    currentRevision: pkg.revision,
    latestRevision: null,
    currentVersion: null,
    latestVersion: null,
    checkedAt,
  }

  // 1. Validate that this is a GitHub-hosted skill
  const repo = resolveGitHubRepo(pkg)
  if (!repo) {
    return { ...base, availability: "unknown", error: "unsupported source" }
  }

  // 2. Require a stored folder hash (lock v1 has none)
  if (!pkg.revision) {
    return { ...base, availability: "unknown", error: "no folder hash in lock (lock v1 not supported)" }
  }

  // 3. Look up the folder in the upstream tree
  const entry = entryMap.get(pkg.name)

  if (!entry) {
    if (truncated) {
      return { ...base, availability: "unknown", error: "tree truncated" }
    }
    // Tree is complete and the folder does not exist → deleted upstream
    return { ...base, availability: "outdated", error: null }
  }

  // 4. Sanity-check the entry type
  if (entry.type !== "tree") {
    return { ...base, availability: "unknown", error: `unexpected entry type: ${entry.type}` }
  }

  // 5. Compare SHAs
  const latestRevision = entry.sha
  if (latestRevision === pkg.revision) {
    return { ...base, latestRevision, availability: "up_to_date", error: null }
  }

  return { ...base, latestRevision, availability: "outdated", error: null }
}
