/**
 * Board domain types.
 *
 * Shared by client and server: the server persists these shapes into SQLite and
 * the client renders them. Pure types plus a handful of pure guards — no IO, so
 * this module is legal everywhere under the side-effect seal.
 */

// ── Boards ────────────────────────────────────────────────────────────────────

/**
 * A board hangs off a project or a Stack. The Stack case is why {@link Card}
 * carries its own `projectId`: on a Stack board the board itself cannot say
 * which checkout "Start work" should use.
 */
export type BoardOwnerKind = "project" | "stack"

/**
 * The role a column plays, independent of what the user named it.
 *
 * Only `active` and `done` drive behaviour ("Start work" moves a card to
 * `active`; reaching `done` prompts about the worktree), and both are optional —
 * a board with no `active` column simply does not move cards automatically. The
 * feature never guesses a column from its title.
 */
export type ColumnSemantic = "start" | "active" | "review" | "done"

export interface Board {
  id: string
  ownerKind: BoardOwnerKind
  ownerId: string
  title: string
  description: string | null
  /** The template this board was instantiated from, if it still exists. */
  templateId: string | null
  /** The card schema for this board. Empty means title-only cards. */
  cardFields: readonly FieldDef[]
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface BoardColumn {
  id: string
  boardId: string
  title: string
  /** Fractional index; see `./rank`. */
  rank: string
  semantic: ColumnSemantic | null
  /** See {@link ColumnColorToken}. Null renders no dot at all. */
  colorToken: ColumnColorToken | null
  wipLimit: number | null
}

/**
 * The colours a column may carry — a CLOSED set of existing design tokens, not
 * a free-form string.
 *
 * Two reasons it is closed. Storing a hex would put an un-themeable value in the
 * database: a colour correct in exactly one of the two themes. And an open set
 * would reintroduce the rainbow-column look the design brief rules out — the
 * palette stays the product's, not the user's.
 *
 * Rendered as a 6px dot beside the column title, never as a background.
 * `destructive` is Kanna Coral and is subject to the One-Voice Rule: rare, and
 * for genuinely destructive or blocked meaning only.
 */
export const COLUMN_COLOR_TOKENS = ["muted-icon", "info", "success", "warning", "destructive"] as const

export type ColumnColorToken = (typeof COLUMN_COLOR_TOKENS)[number]

export function isColumnColorToken(value: string): value is ColumnColorToken {
  return COLUMN_COLOR_TOKENS.some((entry) => entry === value)
}

// ── Card fields ───────────────────────────────────────────────────────────────

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
  /** Present only for `select` / `multiselect`. */
  options: readonly FieldOption[] | null
  required: boolean
}

/**
 * A field's value, discriminated by the same names as {@link FieldKind} so a
 * value can always be checked against its definition without a cast.
 */
export type FieldValue =
  | { kind: "text"; value: string }
  | { kind: "longtext"; value: string }
  | { kind: "url"; value: string }
  | { kind: "number"; value: number }
  /** Epoch milliseconds, UTC. */
  | { kind: "date"; value: number }
  | { kind: "select"; optionId: string | null }
  | { kind: "multiselect"; optionIds: readonly string[] }
  | { kind: "label"; values: readonly string[] }

/** Field values keyed by {@link FieldDef.id}. */
export type CardContent = Readonly<Record<string, FieldValue>>

// ── Cards ─────────────────────────────────────────────────────────────────────

/**
 * Who last touched a card. Attribution is not cosmetic: an agent-origin change
 * is held back from GitHub unless the binding opts in
 * ({@link SyncBinding.allowAgentPush}).
 */
export type CardActor =
  | { kind: "user" }
  | { kind: "agent"; chatId: string }
  | { kind: "sync"; providerId: string }

export interface Card {
  id: string
  boardId: string
  columnId: string
  /**
   * Which project's checkout "Start work" uses. Always set on a Stack board;
   * on a project board it mirrors the board owner.
   */
  projectId: string | null
  title: string
  /** Fractional index within the column; see `./rank`. */
  rank: string
  content: CardContent
  updatedBy: CardActor
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export type CardLinkKind = "chat" | "worktree" | "pr" | "card"

export interface CardLink {
  cardId: string
  kind: CardLinkKind
  /** Chat id, worktree path, PR url, or another card id, per `kind`. */
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

// ── Templates ─────────────────────────────────────────────────────────────────

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
  /** Seeded by migration; cannot be deleted, only copied. */
  builtin: boolean
  definition: BoardTemplateDefinition
  createdAt: number
  updatedAt: number
}

// ── Sync ──────────────────────────────────────────────────────────────────────

/** How a column maps onto something the remote tracker understands. */
export type RemoteKind = "state" | "label" | "projectField"

export type SyncDirection = "pull" | "push" | "both"

/**
 * Where a board's cards come from. One variant per provider adapter; adding a
 * tracker means adding a variant plus an adapter, and every exhaustive switch
 * over this union fails to compile until it is handled.
 */
export type RemoteSourceRef =
  | { provider: "github-issues"; owner: string; repo: string }
  | { provider: "github-projectv2"; owner: string; projectNumber: number; projectId: string }

export type ProviderId = RemoteSourceRef["provider"]

export interface SyncBinding {
  id: string
  boardId: string
  providerId: ProviderId
  sourceRef: RemoteSourceRef
  direction: SyncDirection
  /**
   * Whether a change an AGENT made may be pushed to the remote. Off by default:
   * an agent dragging a card to "done" must not silently close a real issue.
   */
  allowAgentPush: boolean
  /** Provider-defined paging / `since` cursor. */
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
  /**
   * Per-field remote `updatedAt` at the last reconcile, keyed by field id.
   *
   * After a successful push this records the remote timestamp OUR write
   * produced — without that, the next pull reads our own change as a remote one
   * and the two sides ping-pong forever.
   */
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
  /** Set when `origin` is an agent and the binding forbids agent pushes. */
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

// ── Guards ────────────────────────────────────────────────────────────────────

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
const CARD_LINK_KINDS: readonly CardLinkKind[] = ["chat", "worktree", "pr", "card"]

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

/** The column a card should move to when work starts, or null if undefined. */
export function findActiveColumn(columns: readonly BoardColumn[]): BoardColumn | null {
  return columns.find((column) => column.semantic === "active") ?? null
}

/** The column that triggers the worktree cleanup prompt, or null if undefined. */
export function findDoneColumn(columns: readonly BoardColumn[]): BoardColumn | null {
  return columns.find((column) => column.semantic === "done") ?? null
}

// ── Wire snapshots ─────────────────────────────────

export interface BoardSummary {
  id: string
  title: string
  description: string | null
  columnCount: number
  cardCount: number
  updatedAt: number
}

/**
 * Everything the board view needs for a first paint: the board, its columns,
 * per-column totals (so skeletons are sized before their cards arrive), and the
 * first page of each column.
 */
export interface BoardViewSnapshot {
  board: Board
  columns: BoardColumn[]
  counts: Record<string, number>
  cards: Record<string, Card[]>
  cursors: Record<string, string | null>
}

export interface CardDetail {
  card: Card
  links: CardLink[]
  comments: CardComment[]
  /**
   * The tracker's own reference for this card — a GitHub issue number — or null
   * when the card came from nowhere.
   *
   * Carried on the detail rather than re-derived per caller because the branch
   * name is built from it: the drawer previews `card/412-…` and the server
   * creates it, and the two must not be able to disagree.
   */
  externalRef: string | null
}
