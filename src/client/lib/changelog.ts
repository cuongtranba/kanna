import type { GithubRelease } from "../../shared/types"

const CHANGELOG_CACHE_TTL_MS = 5 * 60 * 1000

export type FetchReleases = () => Promise<GithubRelease[]>

interface ChangelogCache {
  expiresAt: number
  releases: GithubRelease[]
}

let changelogCache: ChangelogCache | null = null

export function resetChangelogCache() {
  changelogCache = null
}

export function getCachedChangelog(now: () => number = Date.now) {
  if (!changelogCache) return null
  if (now() >= changelogCache.expiresAt) {
    changelogCache = null
    return null
  }
  return changelogCache.releases
}

export function setCachedChangelog(releases: GithubRelease[], now: () => number = Date.now) {
  changelogCache = {
    releases,
    expiresAt: now() + CHANGELOG_CACHE_TTL_MS,
  }
}

export async function loadChangelog(fetchReleases: FetchReleases, options?: { force?: boolean; now?: () => number }) {
  const now = options?.now ?? Date.now
  const cached = options?.force ? null : getCachedChangelog(now)
  if (cached) {
    return cached
  }

  const releases = await fetchReleases()
  setCachedChangelog(releases, now)
  return releases
}

export function normalizeVersionTag(tag: string): string {
  return tag.trim().replace(/^v/i, "")
}

export function compareSemverTags(a: string, b: string): number {
  const parse = (value: string) =>
    normalizeVersionTag(value)
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part))
  const aParts = parse(a)
  const bParts = parse(b)
  const length = Math.max(aParts.length, bParts.length)
  for (let index = 0; index < length; index += 1) {
    const left = aParts[index] ?? 0
    const right = bParts[index] ?? 0
    if (left === right) continue
    return left < right ? -1 : 1
  }
  return 0
}

export interface ReleaseAction {
  actionLabel: string
  pendingLabel: string
}

export function releaseAction(tag: string, currentVersion: string, latestVersion: string): ReleaseAction {
  if (normalizeVersionTag(tag) === normalizeVersionTag(latestVersion)) {
    return { actionLabel: "Update", pendingLabel: "Updating…" }
  }
  if (compareSemverTags(tag, currentVersion) < 0) {
    return { actionLabel: "Rollback", pendingLabel: "Rolling back…" }
  }
  return { actionLabel: "Install", pendingLabel: "Installing…" }
}

export function formatPublishedDate(value: string | null) {
  if (!value) return "Unpublished"

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Unknown date"

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed)
}
