import type { RemoteSourceRef } from "./types"


export interface RepoSlug {
  owner: string
  repo: string
}

const SEGMENT = /^[A-Za-z0-9._-]+$/u

export function parseRepoSlug(input: string): RepoSlug | null {
  const trimmed = input.trim().replace(/\.git$/u, "")
  if (trimmed === "") return null

  const withoutHost = trimmed
    .replace(/^https?:\/\/(?:www\.)?github\.com\//iu, "")
    .replace(/^git@github\.com:/iu, "")
    .replace(/^ssh:\/\/git@github\.com\//iu, "")

  const segments = withoutHost.split("/").filter((segment) => segment !== "")
  if (segments.length !== 2) return null

  const [owner, repo] = segments
  if (!owner || !repo) return null
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null
  return { owner, repo }
}

export function formatRepoSlug(slug: RepoSlug): string {
  return `${slug.owner}/${slug.repo}`
}

export function sameRepoSlug(a: RepoSlug, b: RepoSlug): boolean {
  return a.owner === b.owner && a.repo === b.repo
}

export function sourceRefLabel(ref: RemoteSourceRef): string {
  return ref.provider === "github-issues" ? formatRepoSlug(ref) : `${ref.owner}/#${ref.projectNumber}`
}

export function sourceRefRepoSlug(ref: RemoteSourceRef): string | null {
  return ref.provider === "github-issues" ? formatRepoSlug(ref) : null
}

export function sourceRefKey(ref: RemoteSourceRef): string {
  return ref.provider === "github-issues"
    ? JSON.stringify({ provider: ref.provider, owner: ref.owner, repo: ref.repo })
    : JSON.stringify({
        provider: ref.provider,
        owner: ref.owner,
        projectNumber: ref.projectNumber,
        projectId: ref.projectId,
      })
}
