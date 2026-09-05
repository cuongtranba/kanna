
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


export interface BoardOwnerRef {
  kind: BoardOwnerKind
  id: string
}

export interface CreateBoardInput {
  owner: BoardOwnerRef
  title: string
  description?: string | null
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
  afterColumnId: string | null
}

export interface CreateCardInput {
  boardId: string
  columnId: string
  projectId?: string | null
  title: string
  content?: CardContent
  actor: CardActor
  afterCardId?: string | null
}

export interface UpdateCardPatch {
  title?: string
  projectId?: string | null
  content?: CardContent
}

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
  afterRank?: string | null
}

export interface CardPage {
  cards: Card[]
  nextCursor: string | null
  total: number
}

export interface CreateTemplateInput {
  name: string
  description?: string | null
  definition: BoardTemplateDefinition
}


export interface BoardStore {
  listBoards(owner: BoardOwnerRef): Board[]
  getBoard(boardId: string): Board | null
  createBoard(input: CreateBoardInput): Board
  updateBoard(boardId: string, patch: UpdateBoardPatch): Board
  archiveBoard(boardId: string): void

  listColumns(boardId: string): BoardColumn[]
  getColumn(columnId: string): BoardColumn | null
  createColumn(input: CreateColumnInput): BoardColumn
  updateColumn(columnId: string, patch: UpdateColumnPatch): BoardColumn
  moveColumn(input: MoveColumnInput): BoardColumn
  deleteColumn(columnId: string): void

  getCard(cardId: string): Card | null
  listCardPage(query: CardPageQuery): CardPage
  countCardsByColumn(boardId: string): Record<string, number>
  createCard(input: CreateCardInput): Card
  updateCard(cardId: string, patch: UpdateCardPatch, actor: CardActor): Card
  moveCard(input: MoveCardInput): Card
  archiveCard(cardId: string, actor: CardActor): void
  rebalanceColumn(columnId: string): void

  listCardLinks(cardId: string): CardLink[]
  addCardLink(cardId: string, kind: CardLinkKind, targetId: string): CardLink
  removeCardLink(cardId: string, kind: CardLinkKind, targetId: string): void
  findCardsByLink(kind: CardLinkKind, targetId: string): Card[]
  listCardLinksForBoard(boardId: string, kind: CardLinkKind): CardLink[]
  listComments(cardId: string): CardComment[]
  addComment(cardId: string, author: CardActor, body: string): CardComment

  listTemplates(): BoardTemplate[]
  getTemplate(templateId: string): BoardTemplate | null
  createTemplate(input: CreateTemplateInput): BoardTemplate
  deleteTemplate(templateId: string): void

  listBindings(boardId: string): SyncBinding[]
  findBindingsBySource(providerId: ProviderId, sourceRef: RemoteSourceRef): SyncBinding[]
  upsertBinding(input: UpsertBindingInput): SyncBinding
  deleteBinding(bindingId: string): void
  setBindingCursor(bindingId: string, cursor: string | null, lastPulledAt: number): void
  getSyncLinkByExternal(bindingId: string, externalId: string): SyncLink | null
  getSyncLinkByCard(cardId: string, bindingId: string): SyncLink | null
  upsertSyncLink(link: SyncLink): void
  enqueueOutbox(entry: EnqueueOutboxInput): SyncOutboxEntry
  dueOutbox(bindingId: string, now: number, limit: number): SyncOutboxEntry[]
  countHeldOutbox(bindingId: string): number
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
  projectId: string | null
}

export interface EnqueueOutboxInput {
  cardId: string
  bindingId: string
  op: OutboxOp
  payload: Readonly<Record<string, FieldValue | string | number | boolean | null>>
  origin: CardActor
  nextAttemptAt: number
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
