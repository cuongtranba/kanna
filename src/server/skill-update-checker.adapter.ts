import { errorMessage, isRecord, type AnyValue } from "../shared/errors"
import type { InstalledPackage, PackageUpdateChecker, PackageUpdateStatus } from "../shared/packages/types"
import {
  resolveGitHubRepo,
  buildEntryMap,
  classifySkillUpdate,
  type GitTreeEntry,
} from "../shared/packages/skill-update-classifier"

// ─── Parsing helpers (type-guard based, no `as T` assertions) ───────────────

function isGitEntryType(t: AnyValue): t is GitTreeEntry["type"] {
  return t === "tree" || t === "blob" || t === "commit"
}

function parseTreeEntries(raw: AnyValue): GitTreeEntry[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.tree)) return null
  const results: GitTreeEntry[] = []
  for (const e of raw.tree) {
    if (!isRecord(e)) continue
    const { path, type, sha } = e
    if (typeof path !== "string" || !isGitEntryType(type) || typeof sha !== "string") continue
    results.push({ path, type, sha })
  }
  return results
}

function parseTreeResponse(raw: AnyValue): { entries: GitTreeEntry[]; truncated: boolean } | null {
  const entries = parseTreeEntries(raw)
  if (!entries) return null
  return { entries, truncated: isRecord(raw) && raw.truncated === true }
}

interface ParsedTag {
  name: string
  commitSha: string
}

function parseTags(raw: AnyValue): ParsedTag[] {
  if (!Array.isArray(raw)) return []
  const results: ParsedTag[] = []
  for (const t of raw) {
    if (!isRecord(t) || typeof t.name !== "string") continue
    if (!isRecord(t.commit) || typeof t.commit.sha !== "string") continue
    results.push({ name: t.name, commitSha: t.commit.sha })
  }
  return results
}

// ─── Dependencies ───────────────────────────────────────────────────────────

export interface SkillCheckerDeps {
  fetchFn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>
  token: string | null
  rateLimitFloor?: number // default 5
  tagScanLimit?: number // default 10
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
  const tagScanLimit = deps.tagScanLimit ?? 10

  // ETag cache per repo: key = owner/repo
  const treeCache = new Map<string, CachedTree>()
  // Tag resolution cache: key = `${owner/repo}:${folderSha}`
  const tagCache = new Map<string, string | null>()

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

    const raw: AnyValue = await resp.json()
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

  async function resolveTagForSha(
    repo: string,
    folderName: string,
    folderSha: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    const cacheKey = `${repo}:${folderSha}`
    if (tagCache.has(cacheKey)) {
      return tagCache.get(cacheKey) ?? null
    }

    if (!token) {
      tagCache.set(cacheKey, null)
      return null
    }

    const headers = buildGitHubHeaders(token, null)

    let tagsResp: Response
    try {
      tagsResp = await fetchFn(
        `https://api.github.com/repos/${repo}/tags?per_page=${tagScanLimit}`,
        { headers, signal },
      )
    } catch {
      tagCache.set(cacheKey, null)
      return null
    }

    if (!tagsResp.ok) {
      tagCache.set(cacheKey, null)
      return null
    }

    const rawTags: AnyValue = await tagsResp.json()
    const tags = parseTags(rawTags)

    for (const tag of tags.slice(0, tagScanLimit)) {
      let treeResp: Response
      try {
        treeResp = await fetchFn(
          `https://api.github.com/repos/${repo}/git/trees/${tag.commitSha}?recursive=1`,
          { headers, signal },
        )
      } catch {
        tagCache.set(cacheKey, null)
        return null
      }

      if (!treeResp.ok) continue

      const rawTree: AnyValue = await treeResp.json()
      const parsed = parseTreeResponse(rawTree)
      if (!parsed) continue

      const match = parsed.entries.find(
        (e) => e.type === "tree" && e.path.split("/").at(-1) === folderName && e.sha === folderSha,
      )
      if (match) {
        tagCache.set(cacheKey, tag.name)
        return tag.name
      }
    }

    tagCache.set(cacheKey, null)
    return null
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
        results.push(classifySkillUpdate(new Map(), false, skill, checkedAt))
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

        const entryMap = buildEntryMap(treeResult.entries)

        for (const skill of repoSkills) {
          results.push(classifySkillUpdate(entryMap, treeResult.truncated, skill, checkedAt))
        }
      }

      // Optional tag resolution: find which tag corresponds to latestRevision
      if (token) {
        for (const result of results) {
          if (!result.latestRevision || result.availability === "unknown") continue
          const skill = skills.find((s) => s.id === result.id)
          if (!skill) continue
          const repo = resolveGitHubRepo(skill)
          if (!repo) continue
          result.latestVersion = await resolveTagForSha(repo, skill.name, result.latestRevision, signal)
        }
      }

      return results
    },
  }
}
