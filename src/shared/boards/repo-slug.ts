
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
