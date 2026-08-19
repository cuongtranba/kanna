/**
 * SQLite implementation of the {@link BoardStore} port.
 *
 * This is the ONLY server file that opens a board database handle, which is why
 * it carries the `.adapter.ts` suffix (see the side-effect seal in
 * `eslint.config.js`). Nothing above it imports `bun:sqlite`.
 *
 * ## Why SQLite here and JSONL everywhere else
 *
 * Kanna's other state is an append-only event log replayed into memory. Boards
 * are not, because two-way sync needs things a replay cannot give cheaply: an
 * indexed lookup by external ref, per-field watermarks, and above all a
 * TRANSACTIONAL OUTBOX — the card write and the intent to push it must commit
 * together, or a crash between them loses the push silently. See
 * `docs/kanban-boards-brainstorm.md` and the accompanying ADR.
 *
 * Ordering relies on SQLite's default BINARY collation sorting order keys the
 * same way JavaScript's `<` does. That parity is pinned by a test; do not add a
 * COLLATE clause to any `rank` column.
 */

import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { LOG_PREFIX } from "../shared/branding"
import { errorMessage, isRecord, type AnyValue } from "../shared/errors"
import {
  decodeActor,
  decodeCardContent,
  decodeFieldDefs,
  decodeFieldValue,
  decodeTemplateDefinition,
} from "../shared/boards/decode"
import { log } from "../shared/log"
import { needsRebalance, rankBetween, ranksBetween } from "../shared/boards/rank"
import {
  isBoardOwnerKind,
  isCardLinkKind,
  isColumnColorToken,
  isColumnSemantic,
  isOutboxOp,
  isSyncDirection,
  type Board,
  type BoardColumn,
  type BoardTemplate,
  type Card,
  type CardContent,
  type CardActor,
  type ColumnColorToken,
  type CardComment,
  type CardLink,
  type CardLinkKind,
  type FieldValue,
  type RemoteSourceRef,
  type SyncBinding,
  type SyncConflict,
  type SyncLink,
  type SyncOutboxEntry,
} from "../shared/boards/types"
import {
  BoardStoreError,
  validateCardContent,
  type BoardOwnerRef,
  type BoardStore,
  type CardPage,
  type CardPageQuery,
  type CreateBoardInput,
  type CreateCardInput,
  type CreateColumnInput,
  type CreateTemplateInput,
  type EnqueueOutboxInput,
  type RecordConflictInput,
  type UpsertBindingInput,
  type MoveCardInput,
  type MoveColumnInput,
  type UpdateBoardPatch,
  type UpdateCardPatch,
  type UpdateColumnPatch,
} from "./board-store"
import { BUILTIN_BOARD_TEMPLATES } from "./board-templates"

export interface CreateBoardStoreOptions {
  /** Database file path, or ":memory:" in tests. */
  filePath: string
  now?: () => number
  newId?: () => string
}

// ── Row shapes ────────────────────────────────────────────────────────────────

interface BoardRow {
  id: string
  owner_kind: string
  owner_id: string
  title: string
  description: string | null
  template_id: string | null
  card_fields: string
  created_at: number
  updated_at: number
  archived_at: number | null
}

interface ColumnRow {
  id: string
  board_id: string
  title: string
  rank: string
  semantic: string | null
  color_token: string | null
  wip_limit: number | null
}

interface CardRow {
  id: string
  board_id: string
  column_id: string
  project_id: string | null
  title: string
  rank: string
  content: string
  updated_by: string
  created_at: number
  updated_at: number
  archived_at: number | null
}

interface CardLinkRow {
  card_id: string
  kind: string
  target_id: string
  created_at: number
}

interface CardCommentRow {
  id: string
  card_id: string
  author: string
  body: string
  created_at: number
}

interface TemplateRow {
  id: string
  name: string
  description: string | null
  builtin: number
  definition: string
  created_at: number
  updated_at: number
}


interface BindingRow {
  id: string
  board_id: string
  provider_id: string
  source_ref: string
  direction: string
  allow_agent_push: number
  cursor: string | null
  last_pulled_at: number | null
}

interface SyncLinkRow {
  card_id: string
  binding_id: string
  external_id: string
  external_url: string | null
  field_watermarks: string
  last_synced_at: number
}

interface OutboxRow {
  id: string
  card_id: string
  binding_id: string
  op: string
  payload: string
  origin: string
  attempts: number
  next_attempt_at: number
  last_error: string | null
  held_reason: string | null
}

interface ConflictRow {
  id: string
  card_id: string
  binding_id: string
  field: string
  local_value: string | null
  remote_value: string | null
  resolved_as: string
  detected_at: number
}

// ── Migrations ────────────────────────────────────────────────────────────────

/**
 * Ordered, append-only. Each entry moves `PRAGMA user_version` forward by one;
 * never edit a shipped entry, add a new one.
 */
const MIGRATIONS: readonly string[] = [
  // 1 — boards, columns, cards, links, comments, templates, and the sync tables.
  `
  CREATE TABLE board (
    id TEXT PRIMARY KEY,
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    template_id TEXT,
    card_fields TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
  );
  CREATE INDEX board_owner_idx ON board (owner_kind, owner_id, archived_at);

  CREATE TABLE board_column (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES board (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    rank TEXT NOT NULL,
    semantic TEXT,
    color_token TEXT,
    wip_limit INTEGER
  );
  CREATE INDEX board_column_board_idx ON board_column (board_id, rank);

  CREATE TABLE card (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES board (id) ON DELETE CASCADE,
    column_id TEXT NOT NULL REFERENCES board_column (id) ON DELETE CASCADE,
    project_id TEXT,
    title TEXT NOT NULL,
    rank TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
  );
  CREATE INDEX card_column_idx ON card (column_id, archived_at, rank);
  CREATE INDEX card_board_idx ON card (board_id, archived_at);

  CREATE TABLE card_link (
    card_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (card_id, kind, target_id)
  );
  CREATE INDEX card_link_target_idx ON card_link (kind, target_id);

  CREATE TABLE card_comment (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX card_comment_card_idx ON card_comment (card_id, created_at);

  CREATE TABLE board_template (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    builtin INTEGER NOT NULL DEFAULT 0,
    definition TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE sync_binding (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES board (id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    direction TEXT NOT NULL,
    allow_agent_push INTEGER NOT NULL DEFAULT 0,
    cursor TEXT,
    last_pulled_at INTEGER
  );
  CREATE INDEX sync_binding_board_idx ON sync_binding (board_id);

  CREATE TABLE column_mapping (
    binding_id TEXT NOT NULL REFERENCES sync_binding (id) ON DELETE CASCADE,
    column_id TEXT NOT NULL REFERENCES board_column (id) ON DELETE CASCADE,
    remote_kind TEXT NOT NULL,
    remote_value TEXT NOT NULL,
    PRIMARY KEY (binding_id, column_id)
  );

  CREATE TABLE sync_link (
    card_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    binding_id TEXT NOT NULL REFERENCES sync_binding (id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    external_url TEXT,
    field_watermarks TEXT NOT NULL,
    last_synced_at INTEGER NOT NULL,
    PRIMARY KEY (card_id, binding_id)
  );
  CREATE UNIQUE INDEX sync_link_external_idx ON sync_link (binding_id, external_id);

  CREATE TABLE sync_outbox (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    binding_id TEXT NOT NULL REFERENCES sync_binding (id) ON DELETE CASCADE,
    op TEXT NOT NULL,
    payload TEXT NOT NULL,
    origin TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    last_error TEXT,
    held_reason TEXT
  );
  CREATE INDEX sync_outbox_due_idx ON sync_outbox (binding_id, held_reason, next_attempt_at);

  CREATE TABLE sync_conflict (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    binding_id TEXT NOT NULL REFERENCES sync_binding (id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    local_value TEXT,
    remote_value TEXT,
    resolved_as TEXT NOT NULL,
    detected_at INTEGER NOT NULL
  );
  CREATE INDEX sync_conflict_card_idx ON sync_conflict (card_id, detected_at);
  `,
]

// ── JSON helpers ──────────────────────────────────────────────────────────────

/**
 * Parse stored JSON, or fail loudly.
 *
 * Shape validation is NOT done here — it lives in `shared/boards/decode.ts`, so
 * this adapter stays a leaf that moves bytes. Invalid JSON, though, means the
 * row itself is damaged, and silently substituting a default would hide that.
 */
function parseJson(text: string, label: string): AnyValue {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new BoardStoreError("conflict", `stored ${label} is not valid JSON: ${errorMessage(error)}`)
  }
}

// ── Row → domain ──────────────────────────────────────────────────────────────

function toBoard(row: BoardRow): Board {
  return {
    id: row.id,
    ownerKind: isBoardOwnerKind(row.owner_kind) ? row.owner_kind : "project",
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    templateId: row.template_id,
    cardFields: decodeFieldDefs(parseJson(row.card_fields, "card field schema")),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }
}

function toColumn(row: ColumnRow): BoardColumn {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    rank: row.rank,
    semantic: row.semantic !== null && isColumnSemantic(row.semantic) ? row.semantic : null,
    colorToken: row.color_token !== null && isColumnColorToken(row.color_token) ? row.color_token : null,
    wipLimit: row.wip_limit,
  }
}

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    projectId: row.project_id,
    title: row.title,
    rank: row.rank,
    content: decodeCardContent(parseJson(row.content, "card content")),
    updatedBy: decodeActor(parseJson(row.updated_by, "actor")),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }
}

function toCardLink(row: CardLinkRow): CardLink {
  return {
    cardId: row.card_id,
    kind: isCardLinkKind(row.kind) ? row.kind : "card",
    targetId: row.target_id,
    createdAt: row.created_at,
  }
}

function toComment(row: CardCommentRow): CardComment {
  return {
    id: row.id,
    cardId: row.card_id,
    author: decodeActor(parseJson(row.author, "actor")),
    body: row.body,
    createdAt: row.created_at,
  }
}

function toTemplate(row: TemplateRow): BoardTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    builtin: row.builtin === 1,
    definition: decodeTemplateDefinition(parseJson(row.definition, "template definition")),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}


function decodeSourceRef(value: AnyValue): RemoteSourceRef {
  if (isRecord(value)) {
    if (value.provider === "github-issues" && typeof value.owner === "string" && typeof value.repo === "string") {
      return { provider: "github-issues", owner: value.owner, repo: value.repo }
    }
    if (
      value.provider === "github-projectv2"
      && typeof value.owner === "string"
      && typeof value.projectNumber === "number"
      && typeof value.projectId === "string"
    ) {
      return {
        provider: "github-projectv2",
        owner: value.owner,
        projectNumber: value.projectNumber,
        projectId: value.projectId,
      }
    }
  }
  // A binding whose source is unreadable must not silently become a DIFFERENT
  // repo, so it degrades to an obviously-empty one the engine will refuse.
  return { provider: "github-issues", owner: "", repo: "" }
}

function decodeWatermarks(value: AnyValue): Record<string, number> {
  if (!isRecord(value)) return {}
  const marks: Record<string, number> = {}
  for (const [field, mark] of Object.entries(value)) {
    if (typeof mark === "number" && Number.isFinite(mark)) marks[field] = mark
  }
  return marks
}

function toBinding(row: BindingRow): SyncBinding {
  const sourceRef = decodeSourceRef(parseJson(row.source_ref, "sync source"))
  return {
    id: row.id,
    boardId: row.board_id,
    providerId: sourceRef.provider,
    sourceRef,
    direction: isSyncDirection(row.direction) ? row.direction : "pull",
    allowAgentPush: row.allow_agent_push === 1,
    cursor: row.cursor,
    lastPulledAt: row.last_pulled_at,
  }
}

function toSyncLink(row: SyncLinkRow): SyncLink {
  return {
    cardId: row.card_id,
    bindingId: row.binding_id,
    externalId: row.external_id,
    externalUrl: row.external_url,
    fieldWatermarks: decodeWatermarks(parseJson(row.field_watermarks, "field watermarks")),
    lastSyncedAt: row.last_synced_at,
  }
}

function toOutbox(row: OutboxRow): SyncOutboxEntry {
  const payload = parseJson(row.payload, "outbox payload")
  return {
    id: row.id,
    cardId: row.card_id,
    bindingId: row.binding_id,
    op: isOutboxOp(row.op) ? row.op : "update",
    payload: isRecord(payload) ? decodeOutboxPayload(payload) : {},
    origin: decodeActor(parseJson(row.origin, "outbox origin")),
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    heldReason: row.held_reason === "agent_push_disabled" ? "agent_push_disabled" : null,
  }
}

function decodeOutboxPayload(
  raw: Record<string, AnyValue>,
): Record<string, FieldValue | string | number | boolean | null> {
  const payload: Record<string, FieldValue | string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      payload[key] = value
      continue
    }
    const field = decodeFieldValue(value)
    if (field) payload[key] = field
  }
  return payload
}

function toConflict(row: ConflictRow): SyncConflict {
  return {
    id: row.id,
    cardId: row.card_id,
    bindingId: row.binding_id,
    field: row.field,
    localValue: row.local_value === null ? null : decodeFieldValue(parseJson(row.local_value, "conflict value")),
    remoteValue: row.remote_value === null ? null : decodeFieldValue(parseJson(row.remote_value, "conflict value")),
    resolvedAs: row.resolved_as === "local" ? "local" : "remote",
    detectedAt: row.detected_at,
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createBoardStore(options: CreateBoardStoreOptions): BoardStore {
  const now = options.now ?? (() => Date.now())
  const newId = options.newId ?? (() => crypto.randomUUID())

  if (options.filePath !== ":memory:") {
    mkdirSync(path.dirname(options.filePath), { recursive: true })
  }

  const db = new Database(options.filePath, { create: true })
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  runMigrations(db)
  seedBuiltinTemplates(db, now)

  // ── internals ───────────────────────────────────────────────────────────────

  function requireBoard(boardId: string): BoardRow {
    const row = db.query<BoardRow, [string]>("SELECT * FROM board WHERE id = ?").get(boardId)
    if (!row) throw new BoardStoreError("not_found", `board ${boardId} does not exist`)
    return row
  }

  function requireColumn(columnId: string): ColumnRow {
    const row = db.query<ColumnRow, [string]>("SELECT * FROM board_column WHERE id = ?").get(columnId)
    if (!row) throw new BoardStoreError("not_found", `column ${columnId} does not exist`)
    return row
  }

  function requireCard(cardId: string): CardRow {
    const row = db.query<CardRow, [string]>("SELECT * FROM card WHERE id = ?").get(cardId)
    if (!row) throw new BoardStoreError("not_found", `card ${cardId} does not exist`)
    return row
  }

  /**
   * The schema gate, on every path that writes card content.
   *
   * Here rather than at each caller because the store is what they have in
   * common: the WS router checks the drawer's writes, and until this ran the
   * sync engine and the board MCP tools were checked by nobody.
   */
  function requireContentMatchesSchema(boardId: string, content: CardContent): void {
    const board = requireBoard(boardId)
    const fields = decodeFieldDefs(parseJson(board.card_fields, "card field schema"))
    const problems = validateCardContent(content, fields)
    if (problems.length > 0) {
      throw new BoardStoreError(
        "invalid_input",
        `card content does not match this board's fields: ${problems.join("; ")}`,
      )
    }
  }

  /** The rank of the first live card strictly after `afterRank` in a column. */
  function nextCardRank(columnId: string, afterRank: string | null): string | null {
    const row = afterRank === null
      ? db
        .query<{ rank: string }, [string]>(
          "SELECT rank FROM card WHERE column_id = ? AND archived_at IS NULL ORDER BY rank LIMIT 1",
        )
        .get(columnId)
      : db
        .query<{ rank: string }, [string, string]>(
          "SELECT rank FROM card WHERE column_id = ? AND archived_at IS NULL AND rank > ? ORDER BY rank LIMIT 1",
        )
        .get(columnId, afterRank)
    return row?.rank ?? null
  }

  function nextColumnRank(boardId: string, afterRank: string | null): string | null {
    const row = afterRank === null
      ? db
        .query<{ rank: string }, [string]>("SELECT rank FROM board_column WHERE board_id = ? ORDER BY rank LIMIT 1")
        .get(boardId)
      : db
        .query<{ rank: string }, [string, string]>(
          "SELECT rank FROM board_column WHERE board_id = ? AND rank > ? ORDER BY rank LIMIT 1",
        )
        .get(boardId, afterRank)
    return row?.rank ?? null
  }

  function rebalanceColumnRanks(columnId: string): void {
    const rows = db
      .query<{ id: string }, [string]>(
        "SELECT id FROM card WHERE column_id = ? AND archived_at IS NULL ORDER BY rank",
      )
      .all(columnId)
    if (rows.length === 0) return
    const ranks = ranksBetween(null, null, rows.length)
    const update = db.query<never, [string, string]>("UPDATE card SET rank = ? WHERE id = ?")
    rows.forEach((row, index) => {
      update.run(ranks[index]!, row.id)
    })
  }

  function insertColumn(
    boardId: string,
    definition: { title: string; semantic: string | null; colorToken: ColumnColorToken | null; wipLimit: number | null },
    rank: string,
  ): ColumnRow {
    const id = newId()
    db.run(
      "INSERT INTO board_column (id, board_id, title, rank, semantic, color_token, wip_limit) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, boardId, definition.title, rank, definition.semantic, definition.colorToken, definition.wipLimit],
    )
    return requireColumn(id)
  }

  function touchBoard(boardId: string): void {
    db.run("UPDATE board SET updated_at = ? WHERE id = ?", [now(), boardId])
  }

  // ── boards ──────────────────────────────────────────────────────────────────

  const createBoardTx = db.transaction((input: CreateBoardInput): string => {
    const id = newId()
    const timestamp = now()
    const definition = input.definition ?? null
    db.run(
      `INSERT INTO board (id, owner_kind, owner_id, title, description, template_id, card_fields, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        id,
        input.owner.kind,
        input.owner.id,
        input.title,
        input.description ?? null,
        input.templateId ?? null,
        JSON.stringify(definition?.cardFields ?? []),
        timestamp,
        timestamp,
      ],
    )
    const columns = definition?.columns ?? []
    if (columns.length > 0) {
      const ranks = ranksBetween(null, null, columns.length)
      columns.forEach((column, index) => {
        insertColumn(
          id,
          {
            title: column.title,
            semantic: column.semantic,
            colorToken: column.colorToken,
            wipLimit: column.wipLimit,
          },
          ranks[index]!,
        )
      })
    }
    return id
  })

  // ── cards ───────────────────────────────────────────────────────────────────

  const createCardTx = db.transaction((input: CreateCardInput): string => {
    const column = requireColumn(input.columnId)
    if (column.board_id !== input.boardId) {
      throw new BoardStoreError("invalid_input", `column ${input.columnId} is not on board ${input.boardId}`)
    }
    if (input.content !== undefined) requireContentMatchesSchema(input.boardId, input.content)
    const afterRank = input.afterCardId === null || input.afterCardId === undefined
      ? null
      : requireCard(input.afterCardId).rank
    const below = nextCardRank(input.columnId, afterRank)
    const rank = rankBetween(afterRank, below)
    const id = newId()
    const timestamp = now()
    db.run(
      `INSERT INTO card (id, board_id, column_id, project_id, title, rank, content, updated_by, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        id,
        input.boardId,
        input.columnId,
        input.projectId ?? null,
        input.title,
        rank,
        JSON.stringify(input.content ?? {}),
        JSON.stringify(input.actor),
        timestamp,
        timestamp,
      ],
    )
    if (needsRebalance(rank)) rebalanceColumnRanks(input.columnId)
    touchBoard(input.boardId)
    return id
  })

  const moveCardTx = db.transaction((input: MoveCardInput): void => {
    if (input.aboveCardId === input.cardId || input.belowCardId === input.cardId) {
      throw new BoardStoreError("invalid_input", "a card cannot be its own neighbour")
    }
    const card = requireCard(input.cardId)
    const target = requireColumn(input.toColumnId)
    if (target.board_id !== card.board_id) {
      throw new BoardStoreError("invalid_input", "cannot move a card to a column on another board")
    }

    const above = input.aboveCardId === null ? null : requireCard(input.aboveCardId)
    const below = input.belowCardId === null ? null : requireCard(input.belowCardId)
    for (const neighbour of [above, below]) {
      if (neighbour && neighbour.column_id !== input.toColumnId) {
        throw new BoardStoreError(
          "invalid_input",
          `neighbour ${neighbour.id} is not in column ${input.toColumnId}`,
        )
      }
    }

    const rank = rankBetween(above?.rank ?? null, below?.rank ?? null)
    db.run("UPDATE card SET column_id = ?, rank = ?, updated_by = ?, updated_at = ? WHERE id = ?", [
      input.toColumnId,
      rank,
      JSON.stringify(input.actor),
      now(),
      input.cardId,
    ])
    if (needsRebalance(rank)) rebalanceColumnRanks(input.toColumnId)
    touchBoard(card.board_id)
  })

  // ── public surface ──────────────────────────────────────────────────────────

  return {
    listBoards(owner: BoardOwnerRef): Board[] {
      return db
        .query<BoardRow, [string, string]>(
          "SELECT * FROM board WHERE owner_kind = ? AND owner_id = ? AND archived_at IS NULL ORDER BY created_at",
        )
        .all(owner.kind, owner.id)
        .map(toBoard)
    },

    getBoard(boardId: string): Board | null {
      const row = db.query<BoardRow, [string]>("SELECT * FROM board WHERE id = ?").get(boardId)
      return row ? toBoard(row) : null
    },

    createBoard(input: CreateBoardInput): Board {
      if (input.title.trim() === "") {
        throw new BoardStoreError("invalid_input", "a board needs a title")
      }
      return toBoard(requireBoard(createBoardTx(input)))
    },

    updateBoard(boardId: string, patch: UpdateBoardPatch): Board {
      const existing = requireBoard(boardId)
      const title = patch.title ?? existing.title
      if (title.trim() === "") {
        throw new BoardStoreError("invalid_input", "a board needs a title")
      }
      db.run("UPDATE board SET title = ?, description = ?, card_fields = ?, updated_at = ? WHERE id = ?", [
        title,
        patch.description === undefined ? existing.description : patch.description,
        patch.cardFields === undefined ? existing.card_fields : JSON.stringify(patch.cardFields),
        now(),
        boardId,
      ])
      return toBoard(requireBoard(boardId))
    },

    archiveBoard(boardId: string): void {
      requireBoard(boardId)
      db.run("UPDATE board SET archived_at = ?, updated_at = ? WHERE id = ?", [now(), now(), boardId])
    },

    getColumn(columnId: string): BoardColumn | null {
      const row = db.query<ColumnRow, [string]>("SELECT * FROM board_column WHERE id = ?").get(columnId)
      return row ? toColumn(row) : null
    },

    listColumns(boardId: string): BoardColumn[] {
      return db
        .query<ColumnRow, [string]>("SELECT * FROM board_column WHERE board_id = ? ORDER BY rank")
        .all(boardId)
        .map(toColumn)
    },

    createColumn(input: CreateColumnInput): BoardColumn {
      requireBoard(input.boardId)
      if (input.title.trim() === "") {
        throw new BoardStoreError("invalid_input", "a column needs a title")
      }
      const afterRank = input.afterColumnId === null || input.afterColumnId === undefined
        ? null
        : requireColumn(input.afterColumnId).rank
      const below = nextColumnRank(input.boardId, afterRank)
      const rank = rankBetween(afterRank, below)
      const row = insertColumn(
        input.boardId,
        {
          title: input.title,
          semantic: input.semantic ?? null,
          colorToken: input.colorToken ?? null,
          wipLimit: input.wipLimit ?? null,
        },
        rank,
      )
      touchBoard(input.boardId)
      return toColumn(row)
    },

    updateColumn(columnId: string, patch: UpdateColumnPatch): BoardColumn {
      const existing = requireColumn(columnId)
      const title = patch.title ?? existing.title
      if (title.trim() === "") {
        throw new BoardStoreError("invalid_input", "a column needs a title")
      }
      db.run("UPDATE board_column SET title = ?, semantic = ?, color_token = ?, wip_limit = ? WHERE id = ?", [
        title,
        patch.semantic === undefined ? existing.semantic : patch.semantic,
        patch.colorToken === undefined ? existing.color_token : patch.colorToken,
        patch.wipLimit === undefined ? existing.wip_limit : patch.wipLimit,
        columnId,
      ])
      touchBoard(existing.board_id)
      return toColumn(requireColumn(columnId))
    },

    moveColumn(input: MoveColumnInput): BoardColumn {
      const column = requireColumn(input.columnId)
      if (input.afterColumnId === input.columnId) {
        throw new BoardStoreError("invalid_input", "a column cannot follow itself")
      }
      const afterRank = input.afterColumnId === null ? null : requireColumn(input.afterColumnId).rank
      let below = nextColumnRank(column.board_id, afterRank)
      if (below === column.rank) {
        below = nextColumnRank(column.board_id, column.rank)
      }
      const rank = rankBetween(afterRank, below)
      db.run("UPDATE board_column SET rank = ? WHERE id = ?", [rank, input.columnId])
      touchBoard(column.board_id)
      return toColumn(requireColumn(input.columnId))
    },

    deleteColumn(columnId: string): void {
      const column = requireColumn(columnId)
      const remaining = db
        .query<{ total: number }, [string]>(
          "SELECT COUNT(*) AS total FROM card WHERE column_id = ? AND archived_at IS NULL",
        )
        .get(columnId)
      if ((remaining?.total ?? 0) > 0) {
        throw new BoardStoreError(
          "column_not_empty",
          `column ${columnId} still holds ${remaining?.total ?? 0} cards; move or archive them first`,
        )
      }
      db.run("DELETE FROM board_column WHERE id = ?", [columnId])
      touchBoard(column.board_id)
    },

    getCard(cardId: string): Card | null {
      const row = db.query<CardRow, [string]>("SELECT * FROM card WHERE id = ?").get(cardId)
      return row ? toCard(row) : null
    },

    listCardPage(query: CardPageQuery): CardPage {
      const limit = Math.max(1, Math.min(query.limit, 500))
      const cursor = query.afterRank ?? null
      const rows = cursor === null
        ? db
          .query<CardRow, [string, number]>(
            "SELECT * FROM card WHERE column_id = ? AND archived_at IS NULL ORDER BY rank LIMIT ?",
          )
          .all(query.columnId, limit + 1)
        : db
          .query<CardRow, [string, string, number]>(
            "SELECT * FROM card WHERE column_id = ? AND archived_at IS NULL AND rank > ? ORDER BY rank LIMIT ?",
          )
          .all(query.columnId, cursor, limit + 1)

      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      const total = db
        .query<{ total: number }, [string]>(
          "SELECT COUNT(*) AS total FROM card WHERE column_id = ? AND archived_at IS NULL",
        )
        .get(query.columnId)?.total ?? 0

      return {
        cards: page.map(toCard),
        nextCursor: hasMore ? (page[page.length - 1]?.rank ?? null) : null,
        total,
      }
    },

    countCardsByColumn(boardId: string): Record<string, number> {
      const rows = db
        .query<{ column_id: string; total: number }, [string]>(
          `SELECT column_id, COUNT(*) AS total FROM card
           WHERE board_id = ? AND archived_at IS NULL GROUP BY column_id`,
        )
        .all(boardId)
      const counts: Record<string, number> = {}
      for (const column of db
        .query<{ id: string }, [string]>("SELECT id FROM board_column WHERE board_id = ?")
        .all(boardId)) {
        counts[column.id] = 0
      }
      for (const row of rows) counts[row.column_id] = row.total
      return counts
    },

    createCard(input: CreateCardInput): Card {
      if (input.title.trim() === "") {
        throw new BoardStoreError("invalid_input", "a card needs a title")
      }
      return toCard(requireCard(createCardTx(input)))
    },

    updateCard(cardId: string, patch: UpdateCardPatch, actor: CardActor): Card {
      const existing = requireCard(cardId)
      const title = patch.title ?? existing.title
      if (title.trim() === "") {
        throw new BoardStoreError("invalid_input", "a card needs a title")
      }
      if (patch.content !== undefined) requireContentMatchesSchema(existing.board_id, patch.content)
      db.run(
        "UPDATE card SET title = ?, project_id = ?, content = ?, updated_by = ?, updated_at = ? WHERE id = ?",
        [
          title,
          patch.projectId === undefined ? existing.project_id : patch.projectId,
          patch.content === undefined ? existing.content : JSON.stringify(patch.content),
          JSON.stringify(actor),
          now(),
          cardId,
        ],
      )
      touchBoard(existing.board_id)
      return toCard(requireCard(cardId))
    },

    moveCard(input: MoveCardInput): Card {
      moveCardTx(input)
      return toCard(requireCard(input.cardId))
    },

    archiveCard(cardId: string, actor: CardActor): void {
      const existing = requireCard(cardId)
      const timestamp = now()
      db.run("UPDATE card SET archived_at = ?, updated_by = ?, updated_at = ? WHERE id = ?", [
        timestamp,
        JSON.stringify(actor),
        timestamp,
        cardId,
      ])
      touchBoard(existing.board_id)
    },

    rebalanceColumn(columnId: string): void {
      requireColumn(columnId)
      db.transaction(() => rebalanceColumnRanks(columnId))()
    },

    listCardLinks(cardId: string): CardLink[] {
      return db
        .query<CardLinkRow, [string]>("SELECT * FROM card_link WHERE card_id = ? ORDER BY created_at")
        .all(cardId)
        .map(toCardLink)
    },

    addCardLink(cardId: string, kind: CardLinkKind, targetId: string): CardLink {
      requireCard(cardId)
      const timestamp = now()
      db.run(
        `INSERT INTO card_link (card_id, kind, target_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (card_id, kind, target_id) DO NOTHING`,
        [cardId, kind, targetId, timestamp],
      )
      const row = db
        .query<CardLinkRow, [string, string, string]>(
          "SELECT * FROM card_link WHERE card_id = ? AND kind = ? AND target_id = ?",
        )
        .get(cardId, kind, targetId)
      if (!row) throw new BoardStoreError("conflict", "card link disappeared immediately after insert")
      return toCardLink(row)
    },

    removeCardLink(cardId: string, kind: CardLinkKind, targetId: string): void {
      db.run("DELETE FROM card_link WHERE card_id = ? AND kind = ? AND target_id = ?", [cardId, kind, targetId])
    },

    findCardsByLink(kind: CardLinkKind, targetId: string): Card[] {
      return db
        .query<CardRow, [string, string]>(
          `SELECT card.* FROM card
           JOIN card_link ON card_link.card_id = card.id
           WHERE card_link.kind = ? AND card_link.target_id = ?
           ORDER BY card.updated_at DESC`,
        )
        .all(kind, targetId)
        .map(toCard)
    },

    listCardLinksForBoard(boardId: string, kind: CardLinkKind): CardLink[] {
      // The subquery is what keeps this board-scoped: written as a plain join,
      // SQLite drives from card_link_target_idx (kind=?) and walks every link
      // of that kind in the store. Driving from the board's cards instead
      // probes the card_link primary key per card, so no new index is needed.
      // rowid breaks a created_at tie in insertion order — two links added in
      // the same millisecond must still read newest-first.
      return db
        .query<CardLinkRow, [string, string]>(
          `SELECT * FROM card_link
           WHERE kind = ? AND card_id IN (SELECT id FROM card WHERE board_id = ?)
           ORDER BY card_id, created_at DESC, rowid DESC`,
        )
        .all(kind, boardId)
        .map(toCardLink)
    },

    listComments(cardId: string): CardComment[] {
      return db
        .query<CardCommentRow, [string]>("SELECT * FROM card_comment WHERE card_id = ? ORDER BY created_at")
        .all(cardId)
        .map(toComment)
    },

    addComment(cardId: string, author: CardActor, body: string): CardComment {
      requireCard(cardId)
      if (body.trim() === "") {
        throw new BoardStoreError("invalid_input", "a comment needs a body")
      }
      const id = newId()
      db.run("INSERT INTO card_comment (id, card_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)", [
        id,
        cardId,
        JSON.stringify(author),
        body,
        now(),
      ])
      const row = db.query<CardCommentRow, [string]>("SELECT * FROM card_comment WHERE id = ?").get(id)
      if (!row) throw new BoardStoreError("conflict", "comment disappeared immediately after insert")
      return toComment(row)
    },

    listTemplates(): BoardTemplate[] {
      return db
        .query<TemplateRow, []>("SELECT * FROM board_template ORDER BY builtin DESC, name")
        .all()
        .map(toTemplate)
    },

    getTemplate(templateId: string): BoardTemplate | null {
      const row = db.query<TemplateRow, [string]>("SELECT * FROM board_template WHERE id = ?").get(templateId)
      return row ? toTemplate(row) : null
    },

    createTemplate(input: CreateTemplateInput): BoardTemplate {
      if (input.name.trim() === "") {
        throw new BoardStoreError("invalid_input", "a template needs a name")
      }
      const id = newId()
      const timestamp = now()
      db.run(
        `INSERT INTO board_template (id, name, description, builtin, definition, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
        [id, input.name, input.description ?? null, JSON.stringify(input.definition), timestamp, timestamp],
      )
      const row = db.query<TemplateRow, [string]>("SELECT * FROM board_template WHERE id = ?").get(id)
      if (!row) throw new BoardStoreError("conflict", "template disappeared immediately after insert")
      return toTemplate(row)
    },

    deleteTemplate(templateId: string): void {
      const row = db.query<TemplateRow, [string]>("SELECT * FROM board_template WHERE id = ?").get(templateId)
      if (!row) throw new BoardStoreError("not_found", `template ${templateId} does not exist`)
      if (row.builtin === 1) {
        throw new BoardStoreError("invalid_input", "built-in templates cannot be deleted")
      }
      db.run("DELETE FROM board_template WHERE id = ?", [templateId])
    },


    // ── Sync ────────────────────────────────────────────────────────────────

    listBindings(boardId: string): SyncBinding[] {
      return db
        .query<BindingRow, [string]>("SELECT * FROM sync_binding WHERE board_id = ?")
        .all(boardId)
        .map(toBinding)
    },

    upsertBinding(input: UpsertBindingInput): SyncBinding {
      const sourceRefJson = JSON.stringify(input.sourceRef)
      const existing = db
        .query<BindingRow, [string, string]>("SELECT * FROM sync_binding WHERE board_id = ? AND source_ref = ?")
        .get(input.boardId, sourceRefJson)
      if (existing) {
        db.run(
          "UPDATE sync_binding SET direction = ?, allow_agent_push = ? WHERE id = ?",
          [input.direction, input.allowAgentPush ? 1 : 0, existing.id],
        )
      } else {
        db.run(
          `INSERT INTO sync_binding (id, board_id, provider_id, source_ref, direction, allow_agent_push, cursor, last_pulled_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
          [
            newId(),
            input.boardId,
            input.providerId,
            sourceRefJson,
            input.direction,
            input.allowAgentPush ? 1 : 0,
          ],
        )
      }
      const row = db
        .query<BindingRow, [string, string]>("SELECT * FROM sync_binding WHERE board_id = ? AND source_ref = ?")
        .get(input.boardId, sourceRefJson)
      if (!row) throw new BoardStoreError("conflict", "binding disappeared immediately after write")
      return toBinding(row)
    },

    deleteBinding(bindingId: string): void {
      const row = db.query<BindingRow, [string]>("SELECT * FROM sync_binding WHERE id = ?").get(bindingId)
      if (!row) throw new BoardStoreError("not_found", `binding ${bindingId} does not exist`)
      // `sync_link`, `sync_outbox`, `sync_conflict` and `column_mapping` all
      // declare ON DELETE CASCADE against this row, so one delete takes the
      // whole binding with it. The CARDS stay: unbinding a repo is not
      // deleting the work it produced.
      db.run("DELETE FROM sync_binding WHERE id = ?", [bindingId])
    },

    setBindingCursor(bindingId: string, cursor: string | null, lastPulledAt: number): void {
      db.run("UPDATE sync_binding SET cursor = ?, last_pulled_at = ? WHERE id = ?", [cursor, lastPulledAt, bindingId])
    },

    getSyncLinkByExternal(bindingId: string, externalId: string): SyncLink | null {
      const row = db
        .query<SyncLinkRow, [string, string]>("SELECT * FROM sync_link WHERE binding_id = ? AND external_id = ?")
        .get(bindingId, externalId)
      return row ? toSyncLink(row) : null
    },

    getSyncLinkByCard(cardId: string, bindingId: string): SyncLink | null {
      const row = db
        .query<SyncLinkRow, [string, string]>("SELECT * FROM sync_link WHERE card_id = ? AND binding_id = ?")
        .get(cardId, bindingId)
      return row ? toSyncLink(row) : null
    },

    upsertSyncLink(link: SyncLink): void {
      db.run(
        `INSERT INTO sync_link (card_id, binding_id, external_id, external_url, field_watermarks, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (card_id, binding_id) DO UPDATE SET
           external_id = excluded.external_id,
           external_url = excluded.external_url,
           field_watermarks = excluded.field_watermarks,
           last_synced_at = excluded.last_synced_at`,
        [
          link.cardId,
          link.bindingId,
          link.externalId,
          link.externalUrl,
          JSON.stringify(link.fieldWatermarks),
          link.lastSyncedAt,
        ],
      )
    },

    enqueueOutbox(entry: EnqueueOutboxInput): SyncOutboxEntry {
      const id = newId()
      db.run(
        `INSERT INTO sync_outbox (id, card_id, binding_id, op, payload, origin, attempts, next_attempt_at, last_error, held_reason)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)`,
        [
          id,
          entry.cardId,
          entry.bindingId,
          entry.op,
          JSON.stringify(entry.payload),
          JSON.stringify(entry.origin),
          entry.nextAttemptAt,
          entry.heldReason,
        ],
      )
      const row = db.query<OutboxRow, [string]>("SELECT * FROM sync_outbox WHERE id = ?").get(id)
      if (!row) throw new BoardStoreError("conflict", "outbox entry disappeared immediately after insert")
      return toOutbox(row)
    },

    dueOutbox(bindingId: string, now: number, limit: number): SyncOutboxEntry[] {
      // `held_reason IS NULL` is the agent-push guard: a held entry stays in the
      // table, visible to the UI, and is never picked up by the drain.
      return db
        .query<OutboxRow, [string, number, number]>(
          `SELECT * FROM sync_outbox
           WHERE binding_id = ? AND held_reason IS NULL AND next_attempt_at <= ?
           ORDER BY next_attempt_at LIMIT ?`,
        )
        .all(bindingId, now, Math.max(1, limit))
        .map(toOutbox)
    },

    countHeldOutbox(bindingId: string): number {
      // The complement of `dueOutbox`'s filter. Without it a drain can report
      // "pushed 0" for a binding holding a queue of agent edits and a binding
      // with nothing to say, which are not the same answer.
      const row = db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM sync_outbox WHERE binding_id = ? AND held_reason IS NOT NULL",
        )
        .get(bindingId)
      return row?.n ?? 0
    },

    settleOutbox(entryId: string): void {
      db.run("DELETE FROM sync_outbox WHERE id = ?", [entryId])
    },

    deferOutbox(entryId: string, nextAttemptAt: number, error: string): void {
      db.run(
        "UPDATE sync_outbox SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE id = ?",
        [nextAttemptAt, error, entryId],
      )
    },

    recordConflict(conflict: RecordConflictInput): SyncConflict {
      const id = newId()
      db.run(
        `INSERT INTO sync_conflict (id, card_id, binding_id, field, local_value, remote_value, resolved_as, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          conflict.cardId,
          conflict.bindingId,
          conflict.field,
          conflict.localValue === null ? null : JSON.stringify(conflict.localValue),
          conflict.remoteValue === null ? null : JSON.stringify(conflict.remoteValue),
          conflict.resolvedAs,
          conflict.detectedAt,
        ],
      )
      const row = db.query<ConflictRow, [string]>("SELECT * FROM sync_conflict WHERE id = ?").get(id)
      if (!row) throw new BoardStoreError("conflict", "conflict row disappeared immediately after insert")
      return toConflict(row)
    },

    listConflicts(boardId: string, limit: number): SyncConflict[] {
      return db
        .query<ConflictRow, [string, number]>(
          `SELECT sync_conflict.* FROM sync_conflict
           JOIN card ON card.id = sync_conflict.card_id
           WHERE card.board_id = ? ORDER BY sync_conflict.detected_at DESC LIMIT ?`,
        )
        .all(boardId, Math.max(1, limit))
        .map(toConflict)
    },

    close(): void {
      db.close()
    },
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

function runMigrations(db: Database): void {
  const current = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0
  if (current > MIGRATIONS.length) {
    throw new BoardStoreError(
      "conflict",
      `board database is at schema version ${current}, newer than this build understands (${MIGRATIONS.length})`,
    )
  }
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!)
      db.exec(`PRAGMA user_version = ${version + 1}`)
    })()
    log.debug(`${LOG_PREFIX} board database migrated to schema version ${version + 1}`)
  }
}

/**
 * Insert any built-in template missing from the database, keyed by its stable
 * id. Idempotent, so adding a template to the list ships it to existing installs
 * on next boot without a migration.
 */
function seedBuiltinTemplates(db: Database, now: () => number): void {
  const insert = db.query<never, [string, string, string | null, string, number, number]>(
    `INSERT INTO board_template (id, name, description, builtin, definition, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
  )
  const timestamp = now()
  db.transaction(() => {
    for (const template of BUILTIN_BOARD_TEMPLATES) {
      insert.run(
        template.id,
        template.name,
        template.description,
        JSON.stringify(template.definition),
        timestamp,
        timestamp,
      )
    }
  })()
}
