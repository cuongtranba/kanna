/**
 * Parsing `owner/repo` as a person types it.
 *
 * Accepts what someone actually has on the clipboard — a bare slug, a browser
 * URL, an `origin` remote — because refusing a pasted GitHub URL and demanding
 * it be retyped is a worse experience than reading it.
 */

export interface RepoSlug {
  owner: string
  repo: string
}

const SEGMENT = /^[A-Za-z0-9._-]+$/u

/** Null when the input is not a repository reference; never a partial guess. */
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
