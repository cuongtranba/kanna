/**
 * The sync provider port.
 *
 * One interface, N trackers. GitHub is the first adapter; a second (GitLab,
 * Jira, Linear) implements the same three methods and needs no change here or
 * in the engine. Adapters FETCH and WRITE; every decision about who wins lives
 * in `board-sync-reconcile.ts`, which is pure and therefore testable without a
 * network or a token.
 */

import type { ProviderId, RemoteSourceRef, SyncBinding, SyncConflict } from "./types"

/** One item as the remote tracker sees it, normalised across providers. */
export interface RemoteItem {
  /** Stable id within the binding — an issue number for GitHub. */
  externalId: string
  url: string
  title: string
  body: string | null
  /** Open/closed is the one state every tracker has. */
  state: "open" | "closed"
  labels: readonly string[]
  assignee: string | null
  /** Epoch milliseconds, as reported by the remote. */
  updatedAt: number
}

export interface ProviderAuth {
  /** Bearer token. How it was obtained is the auth adapter's business. */
  token: string
}

export interface RemoteSource {
  ref: RemoteSourceRef
  label: string
}

export interface PullInput {
  auth: ProviderAuth
  source: RemoteSourceRef
  /** Provider-defined cursor from the previous pull; null for a first sync. */
  cursor: string | null
  /** Hard cap so one pull cannot run unbounded against a huge tracker. */
  limit: number
}

export interface RateLimit {
  remaining: number
  /** Epoch ms when the window resets. */
  resetAt: number
}

export interface PullResult {
  items: readonly RemoteItem[]
  /** Pass back as `cursor` next time. */
  cursor: string | null
  rateLimit: RateLimit | null
}

/** A local change waiting to reach the remote. */
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

/** A column named for the reader, not for the wire. */
export interface SyncColumnRef {
  id: string
  title: string
}

/**
 * Where pulled items land.
 *
 * Not configurable, and deliberately so: open/closed is the one state every
 * tracker has, and it meets a board's user-named columns through
 * {@link ColumnSemantic} alone. The screen shows this rather than offering a
 * mapping, because a second way to say where a card goes is a second way for
 * the screen and the engine to disagree.
 */
export interface SyncColumnRouting {
  /** Null when no column is marked `start`; pulled open items then land in the first column. */
  open: SyncColumnRef | null
  /** Null when no column is marked `done`; closing an item then moves nothing. */
  closed: SyncColumnRef | null
}

/** Everything the sync screen renders, in one read. */
export interface BoardSyncStatus {
  binding: SyncBinding | null
  conflicts: readonly SyncConflict[]
  /** Read from the project's `origin` remote and offered as the default. */
  suggestedRepo: { owner: string; repo: string } | null
  routing: SyncColumnRouting
}
