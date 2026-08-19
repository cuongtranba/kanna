/**
 * The sync engine: pull a binding, apply the pure reconcile decisions, queue
 * what the remote still needs.
 *
 * It owns no IO of its own — the provider, the token reader and the clock are
 * injected — so the whole engine runs against a fake provider and an in-memory
 * database.
 *
 * ## Field mapping
 *
 * A tracker's item and a Kanna card are not the same shape, so the mapping is
 * stated once, here, and nowhere else:
 *
 * | remote     | card                                    |
 * | ---------- | --------------------------------------- |
 * | title      | `card.title`                            |
 * | body       | `content.description`                   |
 * | labels     | `content.labels`                        |
 * | assignee   | `content.assignee`                      |
 * | state      | which COLUMN the card sits in           |
 *
 * `state` is the interesting one: open/closed is the only status every tracker
 * has, and a board's columns are user-defined, so it maps through
 * {@link ColumnSemantic} — `start` for open, `done` for closed. A board with
 * neither marked does not move cards between columns at all, rather than
 * guessing a column from its title.
 */

import type { BoardColumn, Card, CardActor, FieldValue, ProviderId, SyncBinding } from "../shared/boards/types"
import { columnForRemoteState, remoteStateOfColumn } from "../shared/boards/types"
import type { BoardSyncProvider, PushChange, RemoteItem } from "../shared/boards/sync-types"
import type { BoardRegistry } from "./board-registry"
import type { BoardStore } from "./board-store"
import { toError } from "../shared/errors"
import { BoardStoreError } from "./board-store"
import {
  advanceWatermarks,
  reconcileItem,
  watermarksAfterPush,
  type LocalCardState,
  type SyncedField,
} from "./board-sync-reconcile"

const SYNC_ACTOR: CardActor = { kind: "sync", providerId: "github-issues" }

/** How long to wait before retrying a push, doubling per attempt, capped. */
const RETRY_BASE_MS = 30_000
const RETRY_CAP_MS = 30 * 60_000

export interface SyncTokenResult {
  token: string | null
  reason: string
  detail: string | null
}

export interface BoardSyncDeps {
  registry: BoardRegistry
  store: BoardStore
  providers: ReadonlyMap<ProviderId, BoardSyncProvider>
  readToken: () => Promise<SyncTokenResult>
  now: () => number
}

/**
 * What one binding did on a run.
 *
 * A board syncs N repos, and they succeed and fail independently — one
 * rate-limited repo must not stop the others, but it must not VANISH either.
 * A swallowed throw reports a clean zero, which reads exactly like "nothing to
 * sync": the one answer that stops anyone looking for the token that expired
 * or the repo that was renamed.
 */
export interface BindingPullResult {
  bindingId: string
  /** The provider cursor this binding advanced to; unchanged on failure. */
  cursor: string | null
  rateLimitRemaining: number | null
  /** The message that stopped this binding, or null when it succeeded. */
  error: string | null
}

export interface PullSummary {
  created: number
  updated: number
  unchanged: number
  conflicts: number
  queued: number
  rateLimitRemaining: number | null
  /**
   * One entry per binding. There is deliberately no aggregate `cursor`: with N
   * bindings each carries its own, and a summary-level one could only name the
   * last binding to finish — a number that belongs to nothing.
   */
  bindings: readonly BindingPullResult[]
}

export interface DrainSummary {
  pushed: number
  failed: number
  /** Queued by an agent against a binding that forbids agent pushes. */
  held: number
}

function textOf(value: FieldValue | undefined): string | null {
  if (!value) return null
  if (value.kind === "text" || value.kind === "longtext" || value.kind === "url") return value.value
  return null
}

function labelsOf(value: FieldValue | undefined): string[] {
  if (value?.kind === "label") return [...value.values]
  if (value?.kind === "multiselect") return [...value.optionIds]
  return []
}


function toLocalState(card: Card, columns: readonly BoardColumn[]): LocalCardState {
  return {
    cardId: card.id,
    title: card.title,
    body: textOf(card.content.description),
    state: remoteStateOfColumn(columns, card.columnId),
    labels: labelsOf(card.content.labels),
    assignee: textOf(card.content.assignee),
    updatedAt: card.updatedAt,
  }
}

function contentWithTaken(card: Card, remote: RemoteItem, taken: readonly SyncedField[]) {
  const content: Record<string, FieldValue> = { ...card.content }
  for (const field of taken) {
    if (field === "body") content.description = { kind: "longtext", value: remote.body ?? "" }
    if (field === "labels") content.labels = { kind: "label", values: [...remote.labels] }
    if (field === "assignee") content.assignee = { kind: "text", value: remote.assignee ?? "" }
  }
  content.externalUrl = { kind: "url", value: remote.url }
  return content
}

export function createBoardSync(deps: BoardSyncDeps) {
  const { registry, store, providers, readToken, now } = deps

  /**
   * A binding paired with its adapter. `provider` is null when this server
   * carries no adapter for the binding's provider — kept in the list rather
   * than filtered out, so the run can REPORT the misconfiguration instead of
   * making the binding look like it does not exist.
   */
  type BoundEntry = { binding: SyncBinding; provider: BoardSyncProvider | null }

  async function resolve(boardId: string): Promise<{ bindings: BoundEntry[]; auth: { token: string } }> {
    const allBindings = store.listBindings(boardId)
    if (allBindings.length === 0)
      throw new BoardStoreError("not_found", "this board is not connected to a tracker")
    const tokenResult = await readToken()
    if (!tokenResult.token) {
      throw new BoardStoreError(
        "invalid_input",
        tokenResult.reason === "cli_missing"
          ? "GitHub CLI not found. Install `gh` and run `gh auth login`, or add a token in Settings."
          : `GitHub is not authenticated${tokenResult.detail ? `: ${tokenResult.detail}` : "."}`,
      )
    }
    const bindings = allBindings.map((binding) => ({
      binding,
      provider: providers.get(binding.providerId) ?? null,
    }))
    return { bindings, auth: { token: tokenResult.token } }
  }

  /** The bottom card of a column, so an import continues after existing work. */
  function lastCardIdIn(columnId: string): string | null {
    const page = store.listCardPage({ columnId, limit: 500 })
    return page.cards[page.cards.length - 1]?.id ?? null
  }

  /** One binding's contribution to a pull: the counts, plus where it got to. */
  interface OneBindingPull {
    created: number
    updated: number
    unchanged: number
    conflicts: number
    queued: number
    cursor: string | null
    rateLimitRemaining: number | null
  }

  async function pullOneBinding(
    binding: SyncBinding,
    provider: BoardSyncProvider,
    auth: { token: string },
    boardId: string,
    limit: number,
  ): Promise<OneBindingPull> {
    const result = await provider.pull({
      auth,
      source: binding.sourceRef,
      cursor: binding.cursor,
      limit,
    })

    const columns = store.listColumns(boardId)
    // Imports APPEND. A created card with no neighbour goes to the top of its
    // column, so importing a page would present it in reverse — a 300-issue
    // backlog arriving newest-first when the provider served it oldest-first.
    const lastCreatedIn = new Map<string, string>()
    const summary: OneBindingPull = {
      created: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
      queued: 0,
      cursor: result.cursor,
      rateLimitRemaining: result.rateLimit?.remaining ?? null,
    }

    for (const remote of result.items) {
      const link = store.getSyncLinkByExternal(binding.id, remote.externalId)
      const card = link ? store.getCard(link.cardId) : null
      // A link whose card was deleted is stale; treat the item as unseen so
      // it comes back rather than vanishing forever.
      const local = card && card.archivedAt === null ? toLocalState(card, columns) : null

      const decision = reconcileItem({ remote, local, link: local ? link : null })

      if (decision.kind === "unchanged") {
        summary.unchanged += 1
        continue
      }

      if (decision.kind === "create") {
        const column = columnForRemoteState(columns, remote.state) ?? columns[0]
        if (!column) break // A board with no columns has nowhere to put anything.
        const created = registry.createCard({
          boardId,
          columnId: column.id,
          title: remote.title,
          actor: SYNC_ACTOR,
          // Which checkout this issue belongs to. A project board could infer
          // it from the board's owner; a Stack board spans several repos and
          // names none, so the binding that pulled the issue is the only thing
          // that knows — and Start work has nowhere else to look.
          projectId: binding.projectId,
          afterCardId: lastCreatedIn.get(column.id) ?? lastCardIdIn(column.id),
          content: {
            description: { kind: "longtext", value: remote.body ?? "" },
            labels: { kind: "label", values: [...remote.labels] },
            assignee: { kind: "text", value: remote.assignee ?? "" },
            externalUrl: { kind: "url", value: remote.url },
          },
        })
        store.upsertSyncLink({
          cardId: created.id,
          bindingId: binding.id,
          externalId: remote.externalId,
          externalUrl: remote.url,
          fieldWatermarks: advanceWatermarks({}, remote, ["title", "body", "state", "labels", "assignee"]),
          lastSyncedAt: now(),
        })
        lastCreatedIn.set(column.id, created.id)
        summary.created += 1
        continue
      }

      // apply
      if (!card) continue
      if (decision.take.length > 0) {
        registry.updateCard(
          card.id,
          {
            ...(decision.take.includes("title") ? { title: remote.title } : {}),
            content: contentWithTaken(card, remote, decision.take),
          },
          SYNC_ACTOR,
        )
        if (decision.take.includes("state")) {
          const target = columnForRemoteState(columns, remote.state)
          // No column marked for this state means the board has not said
          // where closed work goes; moving it anywhere would be a guess.
          if (target && target.id !== card.columnId) {
            registry.moveCard({
              cardId: card.id,
              toColumnId: target.id,
              aboveCardId: null,
              belowCardId: null,
              actor: SYNC_ACTOR,
            })
          }
        }
        summary.updated += 1
      }

      for (const conflict of decision.conflicts) {
        store.recordConflict({
          cardId: card.id,
          bindingId: binding.id,
          field: conflict.field,
          localValue: { kind: "text", value: String(toLocalState(card, columns)[conflict.field] ?? "") },
          remoteValue: { kind: "text", value: String(remote[conflict.field] ?? "") },
          resolvedAs: conflict.resolvedAs,
          detectedAt: now(),
        })
        summary.conflicts += 1
      }

      if (decision.keep.length > 0) {
        const held = card.updatedBy.kind === "agent" && !binding.allowAgentPush
        store.enqueueOutbox({
          cardId: card.id,
          bindingId: binding.id,
          op: "update",
          payload: { fields: decision.keep.join(",") },
          origin: card.updatedBy,
          nextAttemptAt: now(),
          // An agent moving a card must not silently close a real issue.
          heldReason: held ? "agent_push_disabled" : null,
        })
        summary.queued += 1
      }

      store.upsertSyncLink({
        cardId: card.id,
        bindingId: binding.id,
        externalId: remote.externalId,
        externalUrl: remote.url,
        fieldWatermarks: advanceWatermarks(link?.fieldWatermarks ?? {}, remote, decision.take),
        lastSyncedAt: now(),
      })
    }

    store.setBindingCursor(binding.id, result.cursor, now())
    return summary
  }

  async function drainOneBinding(
    binding: SyncBinding,
    provider: BoardSyncProvider,
    auth: { token: string },
    boardId: string,
    limit: number,
  ): Promise<{ pushed: number; failed: number }> {
    const due = store.dueOutbox(binding.id, now(), limit)
    const columns = store.listColumns(boardId)
    // `held` is not counted here: `dueOutbox` filters held rows out by design,
    // so this loop is structurally unable to see them. The caller asks the
    // store directly.
    const summary = { pushed: 0, failed: 0 }

    for (const entry of due) {
      const card = store.getCard(entry.cardId)
      const link = store.getSyncLinkByCard(entry.cardId, binding.id)
      if (!card) {
        store.settleOutbox(entry.id)
        continue
      }
      const local = toLocalState(card, columns)
      const change: PushChange = {
        externalId: link?.externalId ?? null,
        title: local.title,
        body: local.body,
        state: local.state,
      }
      const [outcome] = await provider.push({ auth, source: binding.sourceRef, changes: [change] })
      if (!outcome) continue

      if (outcome.ok) {
        store.upsertSyncLink({
          cardId: card.id,
          bindingId: binding.id,
          externalId: outcome.externalId,
          externalUrl: outcome.url,
          // Stamped with the remote timestamp OUR write produced, so the next
          // pull does not read it back as a remote change.
          fieldWatermarks: watermarksAfterPush(link?.fieldWatermarks ?? {}, outcome.remoteUpdatedAt, [
            "title",
            "body",
            "state",
            "labels",
            "assignee",
          ]),
          lastSyncedAt: now(),
        })
        store.settleOutbox(entry.id)
        summary.pushed += 1
        continue
      }

      if (!outcome.retryable) {
        store.settleOutbox(entry.id)
        summary.failed += 1
        continue
      }

      const backoff = Math.min(RETRY_BASE_MS * 2 ** entry.attempts, RETRY_CAP_MS)
      store.deferOutbox(entry.id, now() + backoff, outcome.message)
      summary.failed += 1
    }

    return summary
  }

  return {
    async pull(boardId: string, limit = 100): Promise<PullSummary> {
      const { bindings, auth } = await resolve(boardId)
      const results: BindingPullResult[] = []
      const total: PullSummary = {
        created: 0,
        updated: 0,
        unchanged: 0,
        conflicts: 0,
        queued: 0,
        rateLimitRemaining: null,
        bindings: results,
      }

      for (const { binding, provider } of bindings) {
        if (!provider) {
          results.push({
            bindingId: binding.id,
            cursor: binding.cursor,
            rateLimitRemaining: null,
            error: `no adapter for ${binding.providerId}`,
          })
          continue
        }
        try {
          const summary = await pullOneBinding(binding, provider, auth, boardId, limit)
          total.created += summary.created
          total.updated += summary.updated
          total.unchanged += summary.unchanged
          total.conflicts += summary.conflicts
          total.queued += summary.queued
          if (summary.rateLimitRemaining !== null) total.rateLimitRemaining = summary.rateLimitRemaining
          results.push({
            bindingId: binding.id,
            cursor: summary.cursor,
            rateLimitRemaining: summary.rateLimitRemaining,
            error: null,
          })
        } catch (cause) {
          // One repo's failure is isolated from the others — but recorded, so
          // it can be told apart from a repo with nothing to sync.
          results.push({
            bindingId: binding.id,
            cursor: binding.cursor,
            rateLimitRemaining: null,
            error: toError(cause).message,
          })
        }
      }
      return total
    },

    async drain(boardId: string, limit = 25): Promise<DrainSummary> {
      const { bindings, auth } = await resolve(boardId)
      const total: DrainSummary = { pushed: 0, failed: 0, held: 0 }
      for (const { binding, provider } of bindings) {
        // Counted for every binding, including pull-only ones: a held entry is
        // a change waiting on a human, and the direction does not change that.
        total.held += store.countHeldOutbox(binding.id)
        if (!provider || binding.direction === "pull") continue
        try {
          const summary = await drainOneBinding(binding, provider, auth, boardId, limit)
          total.pushed += summary.pushed
          total.failed += summary.failed
        } catch {
          // A push that throws is retried by the outbox on the next drain, so
          // the entry is not lost; counting it as failed here would double-count
          // against the per-entry `failed` the drain already records.
          total.failed += 1
        }
      }
      return total
    },
  }
}

export type BoardSync = ReturnType<typeof createBoardSync>
