import type { InstalledPackage, PackageUpdateStatus } from "./types"

export interface GitTreeEntry {
  path: string
  type: "tree" | "blob" | "commit"
  sha: string
}

/**
 * A repo's tree, indexed the two ways a skill can be located in it.
 *
 * `byPath` is the authoritative index — the lock records the exact folder a
 * skill was installed from. `byName` is the fallback for lock entries written
 * without a `skillPath`, and is lossy by construction: a repo that vendors the
 * same skill into several agent directories has many folders with one base
 * name, and only one of them is the installed one.
 */
export interface UpstreamTreeIndex {
  byPath: ReadonlyMap<string, GitTreeEntry>
  byName: ReadonlyMap<string, GitTreeEntry>
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
 * The upstream folder a lock `skillPath` refers to, normalized to match a
 * GitHub tree entry path.
 *
 * Returns null when the path names no folder — a repo-root `SKILL.md`, whose
 * folder is the root tree and therefore has no entry in a recursive listing.
 * Callers fall back to base-name matching there.
 */
export function deriveSkillFolder(skillPath: string): string | null {
  let folder = skillPath.trim()
  if (!folder) return null
  if (folder.endsWith("/SKILL.md")) folder = folder.slice(0, -"/SKILL.md".length)
  else if (folder === "SKILL.md") folder = ""
  if (folder.startsWith("./")) folder = folder.slice(2)
  while (folder.endsWith("/")) folder = folder.slice(0, -1)
  return folder || null
}

/** Index a GitHub recursive tree response by both full path and folder base name. */
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
    // Keep the shallowest (fewest path segments); ties keep the first seen.
    if (!existing || segments.length < existing.path.split("/").length) {
      byName.set(baseName, entry)
    }
  }
  return { byPath, byName }
}

/**
 * The tag a pinned package would move to, or null when there is nothing to
 * move to. Single source for the three consumers that must agree: the card's
 * button label, the applier's command, and the manager's auto-apply filter.
 */
export function repinTarget(pkg: InstalledPackage, update: PackageUpdateStatus): string | null {
  if (!pkg.pinnedRef) return null
  const latest = update.latestVersion
  if (!latest || latest === pkg.pinnedRef) return null
  return latest
}

/**
 * Locate a package's folder in the upstream tree.
 *
 * When the lock names a folder, that folder is the ONLY acceptable match: if a
 * complete tree does not contain it, the folder is gone upstream. Falling back
 * to a same-named folder elsewhere in the repo is what made `impeccable`
 * permanently outdated — pbakaus/impeccable vendors the skill into 18 agent
 * directories, and the base-name index resolved to whichever tied first.
 */
function findUpstreamEntry(index: UpstreamTreeIndex, pkg: InstalledPackage): GitTreeEntry | null {
  const folder = pkg.installPath ? deriveSkillFolder(pkg.installPath) : null
  if (folder) return index.byPath.get(folder) ?? null
  return index.byName.get(pkg.name) ?? null
}

/**
 * Pure classifier: compares a skill's installed folder hash against the
 * upstream tree entry it was installed from.
 *
 * @param index - the repo's tree, indexed by path and by base name
 * @param truncated - whether the GitHub tree response was truncated
 * @param pkg - the installed package to classify
 * @param checkedAt - timestamp (Date.now()) for the status
 */
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
    // The pin is the skill's "current version"; the checker fills latestVersion
    // with the tag to re-pin to, and only for pinned packages that moved.
    currentVersion: pkg.pinnedRef,
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
  const entry = findUpstreamEntry(index, pkg)

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
