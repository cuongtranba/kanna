
import type { CardBlocker } from "./dependencies"
import { oneOf } from "../vocab"


export const BOARD_OWNER_KINDS = ["project", "stack"] as const
export type BoardOwnerKind = (typeof BOARD_OWNER_KINDS)[number]

export const COLUMN_SEMANTICS = ["start", "active", "review", "done"] as const
export type ColumnSemantic = (typeof COLUMN_SEMANTICS)[number]

export interface Board {
  id: string
  ownerKind: BoardOwnerKind
  ownerId: string
  title: string
  description: string | null
  templateId: string | null
  cardFields: readonly FieldDef[]
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface BoardColumn {
  id: string
  boardId: string
  title: string
  rank: string
  semantic: ColumnSemantic | null
  colorToken: ColumnColorToken | null
  wipLimit: number | null
}

export const COLUMN_COLOR_TOKENS = ["muted-icon", "info", "success", "warning", "destructive"] as const

export type ColumnColorToken = (typeof COLUMN_COLOR_TOKENS)[number]

export const isColumnColorToken = oneOf(COLUMN_COLOR_TOKENS)


export const FIELD_KINDS = ["text", "longtext", "url", "number", "date", "select", "multiselect", "label"] as const
export type FieldKind = (typeof FIELD_KINDS)[number]

export interface FieldOption {
  id: string
  label: string
  colorToken: ColumnColorToken | null
}

export interface FieldDef {
  id: string
  label: string
  kind: FieldKind
  options: readonly FieldOption[] | null
  required: boolean
}

export type FieldValue =
  | { kind: "text"; value: string }
  | { kind: "longtext"; value: string }
  | { kind: "url"; value: string }
  | { kind: "number"; value: number }
  | { kind: "date"; value: number }
  | { kind: "select"; optionId: string | null }
  | { kind: "multiselect"; optionIds: readonly string[] }
  | { kind: "label"; values: readonly string[] }

export type CardContent = Readonly<Record<string, FieldValue>>


export type CardActor =
  | { kind: "user" }
  | { kind: "agent"; chatId: string }
  | { kind: "sync"; providerId: string }
  | { kind: "remote_mcp"; clientId: string; clientName?: string }

export interface Card {
  id: string
  boardId: string
  columnId: string
  projectId: string | null
  title: string
  rank: string
  content: CardContent
  updatedBy: CardActor
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export const CARD_LINK_KINDS = ["chat", "worktree", "pr", "card", "cleanup_declined", "blocked_by"] as const
export type CardLinkKind = (typeof CARD_LINK_KINDS)[number]

export interface CardLink {
  cardId: string
  kind: CardLinkKind
  targetId: string
  createdAt: number
}

export interface CardComment {
  id: string
  cardId: string
  author: CardActor
  body: string
  createdAt: number
}


export interface BoardTemplateColumn {
  title: string
  semantic: ColumnSemantic | null
  colorToken: ColumnColorToken | null
  wipLimit: number | null
}

export interface BoardTemplateMapping {
  columnTitle: string
  remoteKind: RemoteKind
  remoteValue: string
}

export interface BoardTemplateDefinition {
  columns: readonly BoardTemplateColumn[]
  cardFields: readonly FieldDef[]
  mappingDefaults: readonly BoardTemplateMapping[]
}

export interface BoardTemplate {
  id: string
  name: string
  description: string | null
  builtin: boolean
  definition: BoardTemplateDefinition
  createdAt: number
  updatedAt: number
}


export const REMOTE_KINDS = ["state", "label", "projectField"] as const
export type RemoteKind = (typeof REMOTE_KINDS)[number]

export const SYNC_DIRECTIONS = ["pull", "push", "both"] as const
export type SyncDirection = (typeof SYNC_DIRECTIONS)[number]

export type RemoteSourceRef =
  | { provider: "github-issues"; owner: string; repo: string }
  | { provider: "github-projectv2"; owner: string; projectNumber: number; projectId: string }

export type ProviderId = RemoteSourceRef["provider"]

export interface SyncBinding {
  id: string
  boardId: string
  projectId: string | null
  providerId: ProviderId
  sourceRef: RemoteSourceRef
  direction: SyncDirection
  allowAgentPush: boolean
  cursor: string | null
  lastPulledAt: number | null
}

export interface ColumnMapping {
  bindingId: string
  columnId: string
  remoteKind: RemoteKind
  remoteValue: string
}

export interface SyncLink {
  cardId: string
  bindingId: string
  externalId: string
  externalUrl: string | null
  fieldWatermarks: Readonly<Record<string, number>>
  lastSyncedAt: number
}

export const OUTBOX_OPS = ["create", "update", "move", "close"] as const
export type OutboxOp = (typeof OUTBOX_OPS)[number]

export interface SyncOutboxEntry {
  id: string
  cardId: string
  bindingId: string
  op: OutboxOp
  payload: Readonly<Record<string, FieldValue | string | number | boolean | null>>
  origin: CardActor
  attempts: number
  nextAttemptAt: number
  lastError: string | null
  heldReason: "agent_push_disabled" | null
}

export const CONFLICT_RESOLUTIONS = ["local", "remote"] as const
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number]

export interface SyncConflict {
  id: string
  cardId: string
  bindingId: string
  field: string
  localValue: FieldValue | null
  remoteValue: FieldValue | null
  resolvedAs: ConflictResolution
  detectedAt: number
}


export const isColumnSemantic = oneOf(COLUMN_SEMANTICS)
export const isFieldKind = oneOf(FIELD_KINDS)
export const isSyncDirection = oneOf(SYNC_DIRECTIONS)
export const isRemoteKind = oneOf(REMOTE_KINDS)
export const isOutboxOp = oneOf(OUTBOX_OPS)
export const isBoardOwnerKind = oneOf(BOARD_OWNER_KINDS)
export const isCardLinkKind = oneOf(CARD_LINK_KINDS)

export function findActiveColumn(columns: readonly BoardColumn[]): BoardColumn | null {
  return columns.find((column) => column.semantic === "active") ?? null
}

export function findDoneColumn(columns: readonly BoardColumn[]): BoardColumn | null {
  return columns.find((column) => column.semantic === "done") ?? null
}

export function columnForRemoteState(
  columns: readonly BoardColumn[],
  state: "open" | "closed",
): BoardColumn | null {
  return state === "closed" ? findDoneColumn(columns) : findStartColumn(columns)
}

export function findStartColumn(columns: readonly BoardColumn[]): BoardColumn | null {
  return columns.find((column) => column.semantic === "start") ?? null
}

export function remoteStateOfColumn(
  columns: readonly BoardColumn[],
  columnId: string,
): "open" | "closed" {
  return columns.find((column) => column.id === columnId)?.semantic === "done" ? "closed" : "open"
}


export interface BoardSummary {
  id: string
  title: string
  description: string | null
  columnCount: number
  cardCount: number
  updatedAt: number
}

export interface BoardViewSnapshot {
  board: Board
  columns: BoardColumn[]
  counts: Record<string, number>
  cards: Record<string, Card[]>
  cursors: Record<string, string | null>
  chatLinksByCard: Record<string, string[]>
  newSince: number | null
}

export interface CardDetail {
  card: Card
  links: CardLink[]
  comments: CardComment[]
  blockers: readonly CardBlocker[]
  externalRef: string | null
}
