
import { isJsonObject, type JsonValue } from "../shared/json"
import type {
  BoardSyncProvider,
  ProviderAuth,
  PullInput,
  PullResult,
  PushInput,
  PushOutcome,
  RateLimit,
  RemoteItem,
  RemoteSource,
} from "../shared/boards/sync-types"
import type { RemoteSourceRef } from "../shared/boards/types"

const API = "https://api.github.com"

const MAX_PULL_REQUESTS = 10

export interface GitHubFetchOptions {
  fetchImpl?: typeof fetch
}

function headers(auth: ProviderAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "kanna-boards",
  }
}

function repoOf(source: RemoteSourceRef): { owner: string; repo: string } | null {
  return source.provider === "github-issues" ? { owner: source.owner, repo: source.repo } : null
}

function readRateLimit(response: Response): RateLimit | null {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"))
  const reset = Number(response.headers.get("x-ratelimit-reset"))
  if (!Number.isFinite(remaining) || !Number.isFinite(reset)) return null
  return { remaining, resetAt: reset * 1000 }
}

function decodeLabels(value: JsonValue): string[] {
  if (!Array.isArray(value)) return []
  const labels: string[] = []
  for (const entry of value) {
    if (typeof entry === "string") labels.push(entry)
    else if (isJsonObject(entry) && typeof entry.name === "string") labels.push(entry.name)
  }
  return labels
}

function decodeIssue(value: JsonValue): RemoteItem | null {
  if (!isJsonObject(value)) return null
  if ("pull_request" in value) return null
  const { number, title, html_url: htmlUrl, state, updated_at: updatedAt } = value
  if (typeof number !== "number" || typeof title !== "string") return null
  if (typeof updatedAt !== "string") return null
  const parsed = Date.parse(updatedAt)
  if (!Number.isFinite(parsed)) return null

  const rawAssignee = value.assignee
  const assignee = isJsonObject(rawAssignee) && typeof rawAssignee.login === "string" ? rawAssignee.login : null

  return {
    externalId: String(number),
    url: typeof htmlUrl === "string" ? htmlUrl : "",
    title,
    body: typeof value.body === "string" ? value.body : null,
    state: state === "closed" ? "closed" : "open",
    labels: decodeLabels(value.labels),
    assignee,
    updatedAt: parsed,
  }
}

export function createGitHubIssuesProvider(options: GitHubFetchOptions = {}): BoardSyncProvider {
  const doFetch = options.fetchImpl ?? fetch

  return {
    id: "github-issues",
    capabilities: { push: true },

    async discoverSources(auth: ProviderAuth): Promise<readonly RemoteSource[]> {
      const response = await doFetch(`${API}/user/repos?per_page=100&sort=updated`, { headers: headers(auth) })
      if (!response.ok) return []
      const body: JsonValue = await response.json()
      if (!Array.isArray(body)) return []
      const sources: RemoteSource[] = []
      for (const entry of body) {
        if (!isJsonObject(entry)) continue
        const fullName = entry.full_name
        if (typeof fullName !== "string") continue
        const [owner, repo] = fullName.split("/")
        if (!owner || !repo) continue
        sources.push({ ref: { provider: "github-issues", owner, repo }, label: fullName })
      }
      return sources
    },

    async pull(input: PullInput): Promise<PullResult> {
      const repo = repoOf(input.source)
      if (!repo) return { items: [], cursor: input.cursor, rateLimit: null }

      const wanted = Math.min(Math.max(input.limit, 1), 500)
      const perPage = 100
      const items: RemoteItem[] = []
      let cursor = input.cursor
      let rateLimit: RateLimit | null = null

      for (let request = 0; request < MAX_PULL_REQUESTS && items.length < wanted; request += 1) {
        const params = new URLSearchParams({
          state: "all",
          sort: "updated",
          direction: "asc",
          per_page: String(perPage),
        })
        if (cursor) params.set("since", cursor)

        const response = await doFetch(`${API}/repos/${repo.owner}/${repo.repo}/issues?${params.toString()}`, {
          headers: headers(input.auth),
        })
        rateLimit = readRateLimit(response) ?? rateLimit
        if (!response.ok) {
          throw new Error(`GitHub pull failed: ${String(response.status)} ${response.statusText}`)
        }

        const body: JsonValue = await response.json()
        if (!Array.isArray(body) || body.length === 0) break

        let newestSeen = 0
        for (const entry of body) {
          if (isJsonObject(entry) && typeof entry.updated_at === "string") {
            const seen = Date.parse(entry.updated_at)
            if (Number.isFinite(seen)) newestSeen = Math.max(newestSeen, seen)
          }
          const item = decodeIssue(entry)
          if (item) items.push(item)
        }

        const next = newestSeen > 0 ? new Date(newestSeen).toISOString() : cursor
        if (next === cursor) break
        cursor = next

        if (body.length < perPage) break
      }

      return { items: items.slice(0, wanted), cursor, rateLimit }
    },

    async push(input: PushInput): Promise<readonly PushOutcome[]> {
      const repo = repoOf(input.source)
      if (!repo) return input.changes.map(() => ({ ok: false, retryable: false, message: "unsupported source" }))

      const outcomes: PushOutcome[] = []
      for (const change of input.changes) {
        const isCreate = change.externalId === null
        const url = isCreate
          ? `${API}/repos/${repo.owner}/${repo.repo}/issues`
          : `${API}/repos/${repo.owner}/${repo.repo}/issues/${change.externalId ?? ""}`
        const response = await doFetch(url, {
          method: isCreate ? "POST" : "PATCH",
          headers: { ...headers(input.auth), "Content-Type": "application/json" },
          body: JSON.stringify({
            title: change.title,
            body: change.body ?? "",
            ...(isCreate ? {} : { state: change.state }),
          }),
        })

        if (!response.ok) {
          const retryable = response.status >= 500 || response.status === 403 || response.status === 429
          outcomes.push({
            ok: false,
            retryable,
            message: `GitHub push failed: ${String(response.status)} ${response.statusText}`,
          })
          continue
        }

        const body: JsonValue = await response.json()
        const item = decodeIssue(body)
        if (!item) {
          outcomes.push({ ok: false, retryable: false, message: "GitHub returned an unreadable issue" })
          continue
        }
        outcomes.push({ ok: true, externalId: item.externalId, url: item.url, remoteUpdatedAt: item.updatedAt })
      }
      return outcomes
    },
  }
}
