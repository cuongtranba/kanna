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

import type { BoardColumn, Card, CardActor, FieldValue, ProviderId } from "../shared/boards/types"
import type { BoardSyncProvider, PushChange, RemoteItem } from "../shared/boards/sync-types"
import type { BoardRegistry } from "./board-registry"
import type { BoardStore } from "./board-store"
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

export interface PullSummary {
  created: number
  updated: number
  unchanged: number
  conflicts: number
  queued: number
  cursor: string | null
  rateLimitRemaining: number | null
}

export interface DrainSummary {
  pushed: number
  failed: number
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

/** Which column a state maps to, or null when the board has not said. */
function columnForState(columns: readonly BoardColumn[], state: "open" | "closed"): BoardColumn | null {
  const wanted = state === "closed" ? "done" : "start"
  return columns.find((column) => column.semantic === wanted) ?? null
}

function stateOfCard(columns: readonly BoardColumn[], card: Card): "open" | "closed" {
  const column = columns.find((candidate) => candidate.id === card.columnId)
  return column?.semantic === "done" ? "closed" : "open"
}

function toLocalState(card: Card, columns: readonly BoardColumn[]): LocalCardState {
  return {
    cardId: card.id,
    title: card.title,
    body: textOf(card.content.description),
    state: stateOfCard(columns, card),
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

  async function resolve(boardId: string) {
    const binding = store.getBinding(boardId)
    if (!binding) throw new BoardStoreError("not_found", "this board is not connected to a tracker")
    const provider = providers.get(binding.providerId)
    if (!provider) throw new BoardStoreError("invalid_input", `no adapter for ${binding.providerId}`)
    const auth = await readToken()
    if (!auth.token) {
      throw new BoardStoreError(
        "invalid_input",
        auth.reason === "cli_missing"
          ? "GitHub CLI not found. Install `gh` and run `gh auth login`, or add a token in Settings."
          : `GitHub is not authenticated${auth.detail ? `: ${auth.detail}` : "."}`,
      )
    }
    return { binding, provider, auth: { token: auth.token } }
  }

  /** The bottom card of a column, so an import continues after existing work. */
  function lastCardIdIn(columnId: string): string | null {
    const page = store.listCardPage({ columnId, limit: 500 })
    return page.cards[page.cards.length - 1]?.id ?? null
  }

  return {
    async pull(boardId: string, limit = 100): Promise<PullSummary> {
      const { binding, provider, auth } = await resolve(boardId)
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
      const summary: PullSummary = {
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
          const column = columnForState(columns, remote.state) ?? columns[0]
          if (!column) break // A board with no columns has nowhere to put anything.
          const created = registry.createCard({
            boardId,
            columnId: column.id,
            title: remote.title,
            actor: SYNC_ACTOR,
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
            const target = columnForState(columns, remote.state)
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
    },

    async drain(boardId: string, limit = 25): Promise<DrainSummary> {
      const { binding, provider, auth } = await resolve(boardId)
      if (binding.direction === "pull") return { pushed: 0, failed: 0, held: 0 }

      const due = store.dueOutbox(binding.id, now(), limit)
      const columns = store.listColumns(boardId)
      const summary: DrainSummary = { pushed: 0, failed: 0, held: 0 }

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
    },
  }
}

export type BoardSync = ReturnType<typeof createBoardSync>
