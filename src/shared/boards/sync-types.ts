
import type { ProviderId, RemoteSourceRef, SyncBinding, SyncConflict } from "./types"

export interface RemoteItem {
  externalId: string
  url: string
  title: string
  body: string | null
  state: "open" | "closed"
  labels: readonly string[]
  assignee: string | null
  updatedAt: number
}

export interface ProviderAuth {
  token: string
}

export interface RemoteSource {
  ref: RemoteSourceRef
  label: string
}

export interface PullInput {
  auth: ProviderAuth
  source: RemoteSourceRef
  cursor: string | null
  limit: number
}

export interface RateLimit {
  remaining: number
  resetAt: number
}

export interface PullResult {
  items: readonly RemoteItem[]
  cursor: string | null
  rateLimit: RateLimit | null
}

export interface PushChange {
  externalId: string | null
  title: string
  body: string | null
  state: "open" | "closed"
}

export interface PushInput {
  auth: ProviderAuth
  source: RemoteSourceRef
  changes: readonly PushChange[]
}

export type PushOutcome =
  | { ok: true; externalId: string; url: string; remoteUpdatedAt: number }
  | { ok: false; retryable: boolean; message: string }

export interface BoardSyncProvider {
  readonly id: ProviderId
  readonly capabilities: { push: boolean }
  discoverSources(auth: ProviderAuth): Promise<readonly RemoteSource[]>
  pull(input: PullInput): Promise<PullResult>
  push(input: PushInput): Promise<readonly PushOutcome[]>
}

export interface SyncColumnRef {
  id: string
  title: string
}

export interface SyncColumnRouting {
  open: SyncColumnRef | null
  closed: SyncColumnRef | null
}

export interface RepoSuggestion {
  projectId: string
  projectName: string
  repo: { owner: string; repo: string } | null
  boundTo: RepoBoardOwner | null
}

export interface RepoBoardOwner {
  boardId: string
  boardTitle: string
  cardCount: number
}

export interface BoardSyncStatus {
  bindings: SyncBinding[]
  conflicts: readonly SyncConflict[]
  suggestedRepos: readonly RepoSuggestion[]
  routing: SyncColumnRouting
}
