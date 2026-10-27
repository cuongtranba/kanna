
import type { RemoteItem } from "../shared/boards/sync-types"
import { remoteStateOfColumn, type BoardColumn, type Card, type FieldValue } from "../shared/boards/types"
import { cardLabels, cardText, type WellKnownField } from "../shared/boards/well-known-fields"

const LABEL_KEY_SEPARATOR = "\u0000"

export const SYNCED_FIELDS = ["title", "body", "state", "labels", "assignee"] as const

export type SyncedField = (typeof SYNCED_FIELDS)[number]

export interface LocalCardState {
  cardId: string
  title: string
  body: string | null
  state: "open" | "closed"
  labels: readonly string[]
  assignee: string | null
  updatedAt: number
}

export interface SyncLinkState {
  fieldWatermarks: Readonly<Partial<Record<SyncedField, number>>>
  lastSyncedAt: number
}

export interface ReconcileInput {
  remote: RemoteItem
  local: LocalCardState | null
  link: SyncLinkState | null
}

export interface FieldConflict {
  field: SyncedField
  resolvedAs: "local" | "remote"
}

export type ReconcileDecision =
  | { kind: "create"; remote: RemoteItem }
  | { kind: "unchanged"; cardId: string }
  | {
      kind: "apply"
      cardId: string
      take: readonly SyncedField[]
      keep: readonly SyncedField[]
      conflicts: readonly FieldConflict[]
    }

interface SyncedFieldSpec {
  remote(remote: RemoteItem): string
  local(local: LocalCardState): string
  content: ((remote: RemoteItem) => { field: WellKnownField; value: FieldValue }) | null
}

function labelKey(labels: readonly string[]): string {
  return [...labels].sort().join(LABEL_KEY_SEPARATOR)
}

const SYNCED_FIELD_SPEC: Readonly<Record<SyncedField, SyncedFieldSpec>> = {
  title: { remote: (remote) => remote.title, local: (local) => local.title, content: null },
  body: {
    remote: (remote) => remote.body ?? "",
    local: (local) => local.body ?? "",
    content: (remote) => ({ field: "description", value: { kind: "longtext", value: remote.body ?? "" } }),
  },
  state: { remote: (remote) => remote.state, local: (local) => local.state, content: null },
  labels: {
    remote: (remote) => labelKey(remote.labels),
    local: (local) => labelKey(local.labels),
    content: (remote) => ({ field: "labels", value: { kind: "label", values: [...remote.labels] } }),
  },
  assignee: {
    remote: (remote) => remote.assignee ?? "",
    local: (local) => local.assignee ?? "",
    content: (remote) => ({ field: "assignee", value: { kind: "text", value: remote.assignee ?? "" } }),
  },
}

export function localStateOf(card: Card, columns: readonly BoardColumn[]): LocalCardState {
  return {
    cardId: card.id,
    title: card.title,
    body: cardText(card.content, "description"),
    state: remoteStateOfColumn(columns, card.columnId),
    labels: cardLabels(card.content),
    assignee: cardText(card.content, "assignee"),
    updatedAt: card.updatedAt,
  }
}

export function contentFromRemote(
  remote: RemoteItem,
  fields: readonly SyncedField[],
): Record<string, FieldValue> {
  const content: Record<string, FieldValue> = {}
  for (const field of fields) {
    const written = SYNCED_FIELD_SPEC[field].content?.(remote)
    if (written) content[written.field] = written.value
  }
  content.externalUrl = { kind: "url", value: remote.url }
  return content
}

export function reconcileItem(input: ReconcileInput): ReconcileDecision {
  const { remote, local, link } = input
  if (!local) return { kind: "create", remote }

  const localDirty = link !== null && local.updatedAt > link.lastSyncedAt

  const take: SyncedField[] = []
  const keep: SyncedField[] = []
  const conflicts: FieldConflict[] = []

  for (const field of SYNCED_FIELDS) {
    const watermark = link?.fieldWatermarks[field] ?? 0
    const remoteChanged = remote.updatedAt > watermark && SYNCED_FIELD_SPEC[field].remote(remote) !== SYNCED_FIELD_SPEC[field].local(local)

    if (!remoteChanged) {
      if (localDirty && SYNCED_FIELD_SPEC[field].local(local) !== SYNCED_FIELD_SPEC[field].remote(remote)) keep.push(field)
      continue
    }

    if (!localDirty) {
      take.push(field)
      continue
    }

    if (remote.updatedAt >= local.updatedAt) {
      take.push(field)
      conflicts.push({ field, resolvedAs: "remote" })
    } else {
      keep.push(field)
      conflicts.push({ field, resolvedAs: "local" })
    }
  }

  if (take.length === 0 && keep.length === 0) return { kind: "unchanged", cardId: local.cardId }
  return { kind: "apply", cardId: local.cardId, take, keep, conflicts }
}

export function advanceWatermarks(
  current: Readonly<Partial<Record<SyncedField, number>>>,
  at: number,
  fields: readonly SyncedField[],
): Partial<Record<SyncedField, number>> {
  const next: Partial<Record<SyncedField, number>> = { ...current }
  for (const field of fields) next[field] = at
  return next
}
