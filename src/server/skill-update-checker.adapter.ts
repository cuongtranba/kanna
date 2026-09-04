import { errorMessage } from "../shared/errors"
import { isJsonObject, type JsonValue } from "../shared/json"
import type { InstalledPackage, PackageUpdateChecker, PackageUpdateStatus } from "../shared/packages/types"
import {
  resolveGitHubRepo,
  buildTreeIndex,
  classifySkillUpdate,
  type GitTreeEntry,
} from "../shared/packages/skill-update-classifier"
import { pickLatestSemverTag } from "../shared/packages/tag-order"

// ─── Parsing helpers (type-guard based, no `as T` assertions) ───────────────

function isGitEntryType(t: JsonValue): t is GitTreeEntry["type"] {
  return t === "tree" || t === "blob" || t === "commit"
}

function parseTreeEntries(raw: JsonValue): GitTreeEntry[] | null {
  if (!isJsonObject(raw) || !Array.isArray(raw.tree)) return null
  const results: GitTreeEntry[] = []
  for (const e of raw.tree) {
    if (!isJsonObject(e)) continue
    const { path, type, sha } = e
    if (typeof path !== "string" || !isGitEntryType(type) || typeof sha !== "string") continue
    results.push({ path, type, sha })
  }
  return results
}

function parseTreeResponse(raw: JsonValue): { entries: GitTreeEntry[]; truncated: boolean } | null {
  const entries = parseTreeEntries(raw)
  if (!entries) return null
  return { entries, truncated: isJsonObject(raw) && raw.truncated === true }
}

function parseTagNames(raw: JsonValue): string[] {
  if (!Array.isArray(raw)) return []
  const results: string[] = []
  for (const t of raw) {
    if (!isJsonObject(t) || typeof t.name !== "string") continue
    results.push(t.name)
  }
  return results
}

function parseReleaseTagName(raw: JsonValue): string | null {
  if (!isJsonObject(raw)) return null
  return typeof raw.tag_name === "string" && raw.tag_name ? raw.tag_name : null
}

// ─── Dependencies ───────────────────────────────────────────────────────────

export interface SkillCheckerDeps {
  fetchFn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>
  token: string | null
  rateLimitFloor?: number // default 5
  tagScanLimit?: number // default 100 (one page of tags)
}

// ─── Internal cache shapes ───────────────────────────────────────────────────

interface CachedTree {
  etag: string
  entries: GitTreeEntry[]
  truncated: boolean
}

interface TreeFetchResult {
  entries: GitTreeEntry[]
  truncated: boolean
  rateLimitExhausted: boolean
  error: string | null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rateLimitRemaining(resp: Response): number {
  const raw = resp.headers.get("x-ratelimit-remaining")
  if (raw === null) return Number.MAX_SAFE_INTEGER
  const n = parseInt(raw, 10)
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n
}

function buildGitHubHeaders(token: string | null, etag: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (etag) headers["If-None-Match"] = etag
  return headers
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createSkillUpdateChecker(deps: SkillCheckerDeps): PackageUpdateChecker {
  const { fetchFn, token } = deps
  const rateLimitFloor = deps.rateLimitFloor ?? 5
  const tagScanLimit = deps.tagScanLimit ?? 100

  // ETag cache per repo: key = owner/repo
  const treeCache = new Map<string, CachedTree>()
  // Latest-release-tag cache: key = owner/repo. Holds null for "resolved, none".
  const latestTagCache = new Map<string, string | null>()

  async function fetchTree(repo: string, signal: AbortSignal): Promise<TreeFetchResult> {
    const cached = treeCache.get(repo)
    const headers = buildGitHubHeaders(token, cached?.etag ?? null)

    let resp: Response
    try {
      resp = await fetchFn(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`, {
        headers,
        signal,
      })
    } catch (err) {
      return { entries: [], truncated: false, rateLimitExhausted: false, error: errorMessage(err) }
    }

    const remaining = rateLimitRemaining(resp)

    if (resp.status === 304 && cached) {
      return {
        entries: cached.entries,
        truncated: cached.truncated,
        rateLimitExhausted: remaining < rateLimitFloor,
        error: null,
      }
    }

    if (resp.status === 403 || resp.status === 429) {
      const exhausted = remaining <= 0
      return {
        entries: [],
        truncated: false,
        rateLimitExhausted: exhausted,
        error: exhausted ? "rate limited" : `GitHub API error ${resp.status}`,
      }
    }

    if (resp.status === 404) {
      return { entries: [], truncated: false, rateLimitExhausted: false, error: "repository not found" }
    }

    if (!resp.ok) {
      return {
        entries: [],
        truncated: false,
        rateLimitExhausted: false,
        error: `GitHub API error ${resp.status}`,
      }
    }

    const raw: JsonValue = await resp.json()
    const parsed = parseTreeResponse(raw)
    if (!parsed) {
      return { entries: [], truncated: false, rateLimitExhausted: false, error: "invalid tree response" }
    }

    const newEtag = resp.headers.get("etag")
    if (newEtag) {
      treeCache.set(repo, { etag: newEtag, entries: parsed.entries, truncated: parsed.truncated })
    }

    return {
      entries: parsed.entries,
      truncated: parsed.truncated,
      rateLimitExhausted: remaining < rateLimitFloor,
      error: null,
    }
  }

  async function fetchJson(url: string, signal: AbortSignal): Promise<JsonValue | null> {
    try {
      const resp = await fetchFn(url, { headers: buildGitHubHeaders(token, null), signal })
      if (!resp.ok) return null
      return await resp.json()
    } catch {
      return null
    }
  }

  /**
   * The newest release tag in `repo` — the ref a pinned skill would move to.
   *
   * Two sources, in order: the repo's latest RELEASE (authoritative when the
   * project publishes releases), then the highest semver tag on the first page
   * of tags. The tag list is ordered lexicographically by GitHub, so it is read
   * only through `pickLatestSemverTag`, never by position.
   *
   * Resolved at most once per repo per check, and only for pinned packages that
   * are actually behind — an unpinned skill is fixed by a plain `skills update`
   * and needs no tag.
   */
  async function resolveLatestTag(repo: string, signal: AbortSignal): Promise<string | null> {
    const cached = latestTagCache.get(repo)
    if (cached !== undefined) return cached

    const release = parseReleaseTagName(
      await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`, signal),
    )
    if (release) {
      latestTagCache.set(repo, release)
      return release
    }

    const tagNames = parseTagNames(
      await fetchJson(`https://api.github.com/repos/${repo}/tags?per_page=${tagScanLimit}`, signal),
    )
    const latest = pickLatestSemverTag(tagNames)
    latestTagCache.set(repo, latest)
    return latest
  }

  function unknownStatus(skill: InstalledPackage, checkedAt: number, error: string): PackageUpdateStatus {
    return {
      id: skill.id,
      availability: "unknown",
      currentRevision: skill.revision,
      latestRevision: null,
      currentVersion: null,
      latestVersion: null,
      checkedAt,
      error,
    }
  }

  return {
    kind: "skill",

    async check(pkgs, signal) {
      const skills = pkgs.filter((p) => p.kind === "skill")
      const checkedAt = Date.now()

      // Group skills by resolved GitHub repo (null = non-GitHub / invalid)
      const byRepo = new Map<string, InstalledPackage[]>()
      const noRepo: InstalledPackage[] = []

      for (const skill of skills) {
        const repo = resolveGitHubRepo(skill)
        if (!repo) {
          noRepo.push(skill)
        } else {
          const list = byRepo.get(repo)
          if (list) list.push(skill)
          else byRepo.set(repo, [skill])
        }
      }

      const results: PackageUpdateStatus[] = []

      // Skills with no valid GitHub source → classify directly (returns "unknown")
      for (const skill of noRepo) {
        results.push(classifySkillUpdate(buildTreeIndex([]), false, skill, checkedAt))
      }

      let rateLimited = false

      // One tree fetch per repo
      for (const [repo, repoSkills] of byRepo) {
        if (rateLimited) {
          for (const skill of repoSkills) {
            results.push(unknownStatus(skill, checkedAt, "rate limited"))
          }
          continue
        }

        const treeResult = await fetchTree(repo, signal)

        if (treeResult.rateLimitExhausted) {
          rateLimited = true
        }

        if (treeResult.error && treeResult.rateLimitExhausted) {
          for (const skill of repoSkills) {
            results.push(unknownStatus(skill, checkedAt, "rate limited"))
          }
          continue
        }

        if (treeResult.error) {
          for (const skill of repoSkills) {
            results.push(unknownStatus(skill, checkedAt, treeResult.error))
          }
          continue
        }

        const index = buildTreeIndex(treeResult.entries)

        for (const skill of repoSkills) {
          results.push(classifySkillUpdate(index, treeResult.truncated, skill, checkedAt))
        }
      }

      // Resolve the re-pin target for PINNED packages that are behind. A pinned
      // skill is the only kind `skills update` cannot fix — it resolves upstream
      // at the pin and exits 0 unchanged — so it is the only kind that needs a
      // tag to move to. Skipping the rest keeps this to one repo per pinned
      // skill instead of one per outdated skill.
      if (!rateLimited) {
        for (const result of results) {
          if (result.availability !== "outdated") continue
          const skill = skills.find((s) => s.id === result.id)
          if (!skill?.pinnedRef) continue
          const repo = resolveGitHubRepo(skill)
          if (!repo) continue
          result.latestVersion = await resolveLatestTag(repo, signal)
        }
      }

      return results
    },
  }
}
