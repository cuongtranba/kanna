import { z } from "zod"
import {
  boardOwnerKindSchema,
  cardLinkKindSchema,
  columnColorTokenSchema,
  columnSemanticSchema,
  conflictResolutionSchema,
  fieldKindSchema,
  remoteKindSchema,
  syncDirectionSchema,
} from "../../boards/types.schema"
import type { CardDetailView, StartWorkResult } from "../../boards/start-work"
import type { BoardSyncStatus } from "../../boards/sync-types"
import type {
  Board,
  BoardColumn,
  BoardTemplate,
  Card,
  CardComment,
  SyncBinding,
} from "../../boards/types"
import { assertParity } from "../../type-parity"

const fieldOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  colorToken: columnColorTokenSchema.nullable(),
})

const fieldDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: fieldKindSchema,
  options: z.array(fieldOptionSchema).readonly().nullable(),
  required: z.boolean(),
})

const fieldValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("longtext"), value: z.string() }),
  z.object({ kind: z.literal("url"), value: z.string() }),
  z.object({ kind: z.literal("number"), value: z.number() }),
  z.object({ kind: z.literal("date"), value: z.number() }),
  z.object({ kind: z.literal("select"), optionId: z.string().nullable() }),
  z.object({ kind: z.literal("multiselect"), optionIds: z.array(z.string()).readonly() }),
  z.object({ kind: z.literal("label"), values: z.array(z.string()).readonly() }),
])

const cardActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("agent"), chatId: z.string() }),
  z.object({ kind: z.literal("sync"), providerId: z.string() }),
  z.object({ kind: z.literal("remote_mcp"), clientId: z.string(), clientName: z.string().optional() }),
])

export const boardSchema = z.object({
  id: z.string(),
  ownerKind: boardOwnerKindSchema,
  ownerId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  templateId: z.string().nullable(),
  cardFields: z.array(fieldDefSchema).readonly(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().nullable(),
})

export const boardColumnSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  title: z.string(),
  rank: z.string(),
  semantic: columnSemanticSchema.nullable(),
  colorToken: columnColorTokenSchema.nullable(),
  wipLimit: z.number().nullable(),
})

export const cardSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  columnId: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  rank: z.string(),
  content: z.record(z.string(), fieldValueSchema).readonly(),
  updatedBy: cardActorSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number().nullable(),
})

export const cardCommentSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  author: cardActorSchema,
  body: z.string(),
  createdAt: z.number(),
})

const templateColumnSchema = z.object({
  title: z.string(),
  semantic: columnSemanticSchema.nullable(),
  colorToken: columnColorTokenSchema.nullable(),
  wipLimit: z.number().nullable(),
})

export const boardTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  builtin: z.boolean(),
  definition: z.object({
    columns: z.array(templateColumnSchema).readonly(),
    cardFields: z.array(fieldDefSchema).readonly(),
    mappingDefaults: z.array(z.object({
      columnTitle: z.string(),
      remoteKind: remoteKindSchema,
      remoteValue: z.string(),
    })).readonly(),
  }),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const remoteSourceRefSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("github-issues"), owner: z.string(), repo: z.string() }),
  z.object({
    provider: z.literal("github-projectv2"),
    owner: z.string(),
    projectNumber: z.number(),
    projectId: z.string(),
  }),
])

export const syncBindingSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  projectId: z.string().nullable(),
  providerId: z.enum(["github-issues", "github-projectv2"]),
  sourceRef: remoteSourceRefSchema,
  direction: syncDirectionSchema,
  allowAgentPush: z.boolean(),
  cursor: z.string().nullable(),
  lastPulledAt: z.number().nullable(),
})

export const boardSyncStatusSchema = z.object({
  bindings: z.array(syncBindingSchema),
  conflicts: z.array(z.object({
    id: z.string(),
    cardId: z.string(),
    bindingId: z.string(),
    field: z.string(),
    localValue: fieldValueSchema.nullable(),
    remoteValue: fieldValueSchema.nullable(),
    resolvedAs: conflictResolutionSchema,
    detectedAt: z.number(),
  })).readonly(),
  suggestedRepos: z.array(z.object({
    projectId: z.string(),
    projectName: z.string(),
    repo: z.object({ owner: z.string(), repo: z.string() }).nullable(),
    boundTo: z.object({ boardId: z.string(), boardTitle: z.string(), cardCount: z.number() }).nullable(),
  })).readonly(),
  routing: z.object({
    open: z.object({ id: z.string(), title: z.string() }).nullable(),
    closed: z.object({ id: z.string(), title: z.string() }).nullable(),
  }),
})

export const cardDetailViewSchema = z.object({
  card: cardSchema,
  links: z.array(z.object({
    cardId: z.string(),
    kind: cardLinkKindSchema,
    targetId: z.string(),
    createdAt: z.number(),
  })),
  comments: z.array(cardCommentSchema),
  blockers: z.array(z.object({ cardId: z.string(), title: z.string(), cleared: z.boolean() })).readonly(),
  externalRef: z.string().nullable(),
  startWork: z.object({
    status: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("idle") }),
      z.object({ kind: z.literal("worktree"), worktreePath: z.string() }),
      z.object({ kind: z.literal("chat"), chatId: z.string(), worktreePath: z.string().nullable() }),
    ]),
    branch: z.string(),
    blockedReason: z.string().nullable(),
  }).nullable(),
  cleanup: z.object({
    worktreePath: z.string(),
    branch: z.string(),
    dirtyFileCount: z.number(),
    unmergedCommitCount: z.number(),
    hasConflicts: z.boolean(),
  }).nullable(),
})

export const startWorkResultSchema = z.object({
  cardId: z.string(),
  chatId: z.string(),
  branch: z.string(),
  worktreePath: z.string().nullable(),
  movedToColumnId: z.string().nullable(),
  reused: z.boolean(),
})

export const worktreeCleanupOutcomeSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("leave"), worktreePath: z.string() }),
  z.object({ decision: z.literal("discard"), worktreePath: z.string() }),
  z.object({ decision: z.literal("merge"), worktreePath: z.string(), message: z.string() }),
])

export const cardPageSchema = z.object({
  cards: z.array(cardSchema),
  nextCursor: z.string().nullable(),
  total: z.number(),
})

export const syncUnbindResultSchema = z.object({ bindingId: z.string() })

export const bindingPullResultSchema = z.object({
  bindingId: z.string(),
  cursor: z.string().nullable(),
  rateLimitRemaining: z.number().nullable(),
  error: z.string().nullable(),
})

export const pullSummarySchema = z.object({
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  conflicts: z.number(),
  queued: z.number(),
  rateLimitRemaining: z.number().nullable(),
  bindings: z.array(bindingPullResultSchema).readonly(),
})

export const drainSummarySchema = z.object({ pushed: z.number(), failed: z.number(), held: z.number() })

export type BindingPullResult = z.output<typeof bindingPullResultSchema>
export type PullSummary = z.output<typeof pullSummarySchema>
export type DrainSummary = z.output<typeof drainSummarySchema>
export type WorktreeCleanupOutcome = z.output<typeof worktreeCleanupOutcomeSchema>
export type CardPage = z.output<typeof cardPageSchema>

assertParity<z.output<typeof boardSchema>, Board>()
assertParity<z.output<typeof boardColumnSchema>, BoardColumn>()
assertParity<z.output<typeof cardSchema>, Card>()
assertParity<z.output<typeof cardCommentSchema>, CardComment>()
assertParity<z.output<typeof boardTemplateSchema>, BoardTemplate>()
assertParity<z.output<typeof syncBindingSchema>, SyncBinding>()
assertParity<z.output<typeof boardSyncStatusSchema>, BoardSyncStatus>()
assertParity<z.output<typeof cardDetailViewSchema>, CardDetailView>()
assertParity<z.output<typeof startWorkResultSchema>, StartWorkResult>()
