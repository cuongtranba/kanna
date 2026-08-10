/**
 * The sync provider port.
 *
 * One interface, N trackers. GitHub is the first adapter; a second (GitLab,
 * Jira, Linear) implements the same three methods and needs no change here or
 * in the engine. Adapters FETCH and WRITE; every decision about who wins lives
 * in `board-sync-reconcile.ts`, which is pure and therefore testable without a
 * network or a token.
 */

import type { ProviderId, RemoteSourceRef } from "./types"

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
