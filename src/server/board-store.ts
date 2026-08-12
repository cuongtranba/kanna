/**
 * The board persistence port.
 *
 * This module is types and pure logic only — no `bun:sqlite`, no filesystem.
 * The implementation lives in `board-store.adapter.ts`, which is the single
 * file in the server allowed to open a database handle. Everything else in
 * Kanna depends on the interface below, so the storage engine can be replaced
 * without touching a call site.
 *
 * Ordering is fractional (`src/shared/boards/rank.ts`), so a move is one row
 * update. Callers name a card's NEIGHBOURS rather than computing a rank: the
 * store resolves their current ranks under the same transaction as the write,
 * which is what makes a drag safe while an agent is moving cards in parallel.
 */

import type {
  Board,
  BoardColumn,
  BoardOwnerKind,
  BoardTemplate,
  BoardTemplateDefinition,
  Card,
  CardActor,
  CardComment,
  CardLink,
  CardLinkKind,
  ColumnColorToken,
  ColumnSemantic,
  ConflictResolution,
  FieldValue,
  OutboxOp,
  ProviderId,
  RemoteSourceRef,
  SyncBinding,
  SyncConflict,
  SyncDirection,
  SyncLink,
  SyncOutboxEntry,
  FieldDef,
  CardContent,
} from "../shared/boards/types"

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Note there is no `wip_limit_exceeded`. A column's WIP limit is advisory: it is
 * surfaced in the UI when a column is over it, and never blocks a write. A hard
 * limit would let a full column wedge an agent mid-run — the agent has no way to
 * negotiate, so it would fail its turn over a planning convention.
 */
export type BoardStoreErrorCode =
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "column_not_empty"

export class BoardStoreError extends Error {
  readonly code: BoardStoreErrorCode

  constructor(code: BoardStoreErrorCode, message: string) {
    super(message)
    this.name = "BoardStoreError"
    this.code = code
  }
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface BoardOwnerRef {
  kind: BoardOwnerKind
  id: string
}

export interface CreateBoardInput {
  owner: BoardOwnerRef
  title: string
  description?: string | null
  /** Columns and card schema to instantiate. Omit for an empty board. */
  definition?: BoardTemplateDefinition | null
  templateId?: string | null
}

export interface UpdateBoardPatch {
  title?: string
  description?: string | null
  cardFields?: readonly FieldDef[]
}

export interface CreateColumnInput {
  boardId: string
  title: string
  semantic?: ColumnSemantic | null
  colorToken?: ColumnColorToken | null
  wipLimit?: number | null
  /** Insert after this column; null puts the new column first. */
  afterColumnId?: string | null
}

export interface UpdateColumnPatch {
  title?: string
  semantic?: ColumnSemantic | null
  colorToken?: ColumnColorToken | null
  wipLimit?: number | null
}

export interface MoveColumnInput {
  columnId: string
  /** The column it should sit after; null means "first". */
  afterColumnId: string | null
}

export interface CreateCardInput {
  boardId: string
  columnId: string
  projectId?: string | null
  title: string
  content?: CardContent
  actor: CardActor
  /** Insert after this card; null puts the new card at the top of the column. */
  afterCardId?: string | null
}

export interface UpdateCardPatch {
  title?: string
  projectId?: string | null
  content?: CardContent
}

/**
 * A drop, expressed the way the UI reports it: the card, its destination
 * column, and the cards it landed between. The store resolves those neighbours
 * to ranks itself — a client that computed the rank would be racing every other
 * writer on the board.
 */
export interface MoveCardInput {
  cardId: string
  toColumnId: string
  aboveCardId: string | null
  belowCardId: string | null
  actor: CardActor
}

export interface CardPageQuery {
  columnId: string
  limit: number
  /** Keyset cursor: the rank of the last card already delivered. */
  afterRank?: string | null
}

export interface CardPage {
  cards: Card[]
  /** Pass back as `afterRank` for the next page; null when exhausted. */
  nextCursor: string | null
  /** Total non-archived cards in the column, for skeleton counts. */
  total: number
}

export interface CreateTemplateInput {
  name: string
  description?: string | null
  definition: BoardTemplateDefinition
}

// ── Port ──────────────────────────────────────────────────────────────────────

export interface BoardStore {
  // Boards
  listBoards(owner: BoardOwnerRef): Board[]
  getBoard(boardId: string): Board | null
  createBoard(input: CreateBoardInput): Board
  updateBoard(boardId: string, patch: UpdateBoardPatch): Board
  archiveBoard(boardId: string): void

  // Columns
  listColumns(boardId: string): BoardColumn[]
  /** Resolve one column without knowing its board — used to route a change broadcast. */
  getColumn(columnId: string): BoardColumn | null
  createColumn(input: CreateColumnInput): BoardColumn
  updateColumn(columnId: string, patch: UpdateColumnPatch): BoardColumn
  moveColumn(input: MoveColumnInput): BoardColumn
  /** Refuses while the column still holds cards; move or archive them first. */
  deleteColumn(columnId: string): void

  // Cards
  getCard(cardId: string): Card | null
  listCardPage(query: CardPageQuery): CardPage
  /** Non-archived card counts keyed by column id, for column headers. */
  countCardsByColumn(boardId: string): Record<string, number>
  createCard(input: CreateCardInput): Card
  updateCard(cardId: string, patch: UpdateCardPatch, actor: CardActor): Card
  moveCard(input: MoveCardInput): Card
  archiveCard(cardId: string, actor: CardActor): void
  /** Rewrites one column's ranks when they have grown too long. */
  rebalanceColumn(columnId: string): void

  // Links and comments
  listCardLinks(cardId: string): CardLink[]
  addCardLink(cardId: string, kind: CardLinkKind, targetId: string): CardLink
  removeCardLink(cardId: string, kind: CardLinkKind, targetId: string): void
  /** Every card linked to a given target, e.g. "which card owns this chat?". */
  findCardsByLink(kind: CardLinkKind, targetId: string): Card[]
  /**
   * Every link of `kind` on a whole board, grouped by card and newest first
   * within each card — one query, so a board view never fans out to one read
   * per card it ships.
   */
  listCardLinksForBoard(boardId: string, kind: CardLinkKind): CardLink[]
  listComments(cardId: string): CardComment[]
  addComment(cardId: string, author: CardActor, body: string): CardComment

  // Templates
  listTemplates(): BoardTemplate[]
  getTemplate(templateId: string): BoardTemplate | null
  createTemplate(input: CreateTemplateInput): BoardTemplate
  /** Refuses on a built-in template; those are seeded, not owned. */
  deleteTemplate(templateId: string): void

  // Sync
  getBinding(boardId: string): SyncBinding | null
  upsertBinding(input: UpsertBindingInput): SyncBinding
  setBindingCursor(bindingId: string, cursor: string | null, lastPulledAt: number): void
  getSyncLinkByExternal(bindingId: string, externalId: string): SyncLink | null
  getSyncLinkByCard(cardId: string, bindingId: string): SyncLink | null
  upsertSyncLink(link: SyncLink): void
  /**
   * Queue a push in the SAME transaction as the write that caused it.
   * A crash between the two would otherwise lose the push silently — the
   * reason boards use a database rather than the event log.
   */
  enqueueOutbox(entry: EnqueueOutboxInput): SyncOutboxEntry
  dueOutbox(bindingId: string, now: number, limit: number): SyncOutboxEntry[]
  settleOutbox(entryId: string): void
  deferOutbox(entryId: string, nextAttemptAt: number, error: string): void
  recordConflict(conflict: RecordConflictInput): SyncConflict
  listConflicts(boardId: string, limit: number): SyncConflict[]

  close(): void
}

export interface UpsertBindingInput {
  boardId: string
  providerId: ProviderId
  sourceRef: RemoteSourceRef
  direction: SyncDirection
  allowAgentPush: boolean
}

export interface EnqueueOutboxInput {
  cardId: string
  bindingId: string
  op: OutboxOp
  payload: Readonly<Record<string, FieldValue | string | number | boolean | null>>
  origin: CardActor
  nextAttemptAt: number
  /** Set when an agent made the change and the binding forbids agent pushes. */
  heldReason: "agent_push_disabled" | null
}

export interface RecordConflictInput {
  cardId: string
  bindingId: string
  field: string
  localValue: FieldValue | null
  remoteValue: FieldValue | null
  resolvedAs: ConflictResolution
  detectedAt: number
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Validate a card's content against its board's field schema.
 *
 * The STORE's gate, applied to every write from every caller. The WS router's
 * `decodeContentForFields` guards only the one path a person edits from; this
 * stands under the sync engine, the board MCP tools, and whatever is added
 * next.
 *
 * It reports CONTRADICTIONS and nothing else: a value whose kind disagrees with
 * its field's, an option the board does not offer, a number that is not one, a
 * date that is not epoch milliseconds. Each of those already reads as unset in
 * the drawer and would be dropped by the next write, so storing it loses the
 * value either way — refusing at least says so.
 *
 * Two things it does NOT report, both of which the wire decoder does, and the
 * asymmetry is deliberate:
 *
 * A field id the schema has not declared is not a contradiction here. A board's
 * schema is edited under content already written, and an orphaned value is left
 * in place on purpose — the storage decoder keeps it readable, so re-adding the
 * field restores it. The sync engine also writes `description` / `labels` /
 * `assignee` onto boards that never declared them; refusing there would turn a
 * GitHub pull into a hard failure on every board created without a template.
 * The wire decoder can afford to refuse because the drawer that sends to it
 * renders exactly this schema, so an id it has not heard of is a client bug.
 *
 * A missing required field is not one either. `required` marks a field, it
 * never refuses a save — enforcing it here would make every existing card
 * unwritable the moment a board added a required field.
 *
 * Returns the problems rather than throwing so a caller can report all of them
 * at once.
 */
export function validateCardContent(content: CardContent, fields: readonly FieldDef[]): string[] {
  const problems: string[] = []
  const byId = new Map(fields.map((field) => [field.id, field]))

  for (const [fieldId, value] of Object.entries(content)) {
    const field = byId.get(fieldId)
    if (!field) continue
    if (value.kind !== field.kind) {
      problems.push(`field ${JSON.stringify(fieldId)} expects ${field.kind}, received ${value.kind}`)
      continue
    }
    if (value.kind === "select" && value.optionId !== null) {
      const options = field.options ?? []
      if (!options.some((option) => option.id === value.optionId)) {
        problems.push(`field ${JSON.stringify(fieldId)} has no option ${JSON.stringify(value.optionId)}`)
      }
    }
    if (value.kind === "multiselect") {
      const options = field.options ?? []
      for (const optionId of value.optionIds) {
        if (!options.some((option) => option.id === optionId)) {
          problems.push(`field ${JSON.stringify(fieldId)} has no option ${JSON.stringify(optionId)}`)
        }
      }
    }
    if (value.kind === "number" && !Number.isFinite(value.value)) {
      problems.push(`field ${JSON.stringify(fieldId)} must be a finite number`)
    }
    if (value.kind === "date" && !Number.isInteger(value.value)) {
      problems.push(`field ${JSON.stringify(fieldId)} must be epoch milliseconds`)
    }
  }

  return problems
}

/**
 * Slug used for a card's branch and worktree, e.g.
 * `card/412-fix-login-redirect-loop`.
 *
 * Derived, never asked. `externalRef` is the tracker's number when the card came
 * from one, so a branch stays recognisable against the issue it implements.
 */
export function cardBranchName(cardId: string, title: string, externalRef: string | null): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "")
  const reference = externalRef ?? cardId.slice(0, 8)
  return slug ? `card/${reference}-${slug}` : `card/${reference}`
}
