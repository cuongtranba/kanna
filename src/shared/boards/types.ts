
import type { CardBlocker } from "./dependencies"


export type BoardOwnerKind = "project" | "stack"

export type ColumnSemantic = "start" | "active" | "review" | "done"

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

export function isColumnColorToken(value: string): value is ColumnColorToken {
  return COLUMN_COLOR_TOKENS.some((entry) => entry === value)
}


export type FieldKind =
  | "text"
  | "longtext"
  | "url"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "label"

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

export type CardLinkKind = "chat" | "worktree" | "pr" | "card" | "cleanup_declined" | "blocked_by"

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


export type RemoteKind = "state" | "label" | "projectField"

export type SyncDirection = "pull" | "push" | "both"

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

export type OutboxOp = "create" | "update" | "move" | "close"

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

export type ConflictResolution = "local" | "remote"

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


const COLUMN_SEMANTICS: readonly ColumnSemantic[] = ["start", "active", "review", "done"]
const FIELD_KINDS: readonly FieldKind[] = [
  "text",
  "longtext",
  "url",
  "number",
  "date",
  "select",
  "multiselect",
  "label",
]
const SYNC_DIRECTIONS: readonly SyncDirection[] = ["pull", "push", "both"]
const REMOTE_KINDS: readonly RemoteKind[] = ["state", "label", "projectField"]
const OUTBOX_OPS: readonly OutboxOp[] = ["create", "update", "move", "close"]
const BOARD_OWNER_KINDS: readonly BoardOwnerKind[] = ["project", "stack"]
const CARD_LINK_KINDS: readonly CardLinkKind[] = [
  "chat",
  "worktree",
  "pr",
  "card",
  "cleanup_declined",
  "blocked_by",
]

export function isColumnSemantic(value: string): value is ColumnSemantic {
  return COLUMN_SEMANTICS.some((entry) => entry === value)
}

export function isFieldKind(value: string): value is FieldKind {
  return FIELD_KINDS.some((entry) => entry === value)
}

export function isSyncDirection(value: string): value is SyncDirection {
  return SYNC_DIRECTIONS.some((entry) => entry === value)
}

export function isRemoteKind(value: string): value is RemoteKind {
  return REMOTE_KINDS.some((entry) => entry === value)
}

export function isOutboxOp(value: string): value is OutboxOp {
  return OUTBOX_OPS.some((entry) => entry === value)
}

export function isBoardOwnerKind(value: string): value is BoardOwnerKind {
  return BOARD_OWNER_KINDS.some((entry) => entry === value)
}

export function isCardLinkKind(value: string): value is CardLinkKind {
  return CARD_LINK_KINDS.some((entry) => entry === value)
}

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
