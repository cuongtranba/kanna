import { z } from "zod"
import {
  BOARD_OWNER_KINDS,
  CARD_LINK_KINDS,
  COLUMN_COLOR_TOKENS,
  COLUMN_SEMANTICS,
  CONFLICT_RESOLUTIONS,
  FIELD_KINDS,
  REMOTE_KINDS,
  SYNC_DIRECTIONS,
  type FieldDef,
} from "./types"
import { CLEANUP_DECISIONS } from "./worktree-cleanup"
import { assertParity } from "../type-parity"

export const boardOwnerKindSchema = z.enum(BOARD_OWNER_KINDS)
export const columnSemanticSchema = z.enum(COLUMN_SEMANTICS)
export const columnColorTokenSchema = z.enum(COLUMN_COLOR_TOKENS)
export const syncDirectionSchema = z.enum(SYNC_DIRECTIONS)
export const cleanupDecisionSchema = z.enum(CLEANUP_DECISIONS)
export const fieldKindSchema = z.enum(FIELD_KINDS)
export const remoteKindSchema = z.enum(REMOTE_KINDS)
export const conflictResolutionSchema = z.enum(CONFLICT_RESOLUTIONS)
export const cardLinkKindSchema = z.enum(CARD_LINK_KINDS)

export const fieldOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  colorToken: columnColorTokenSchema.nullable(),
})

export const fieldDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: fieldKindSchema,
  options: z.array(fieldOptionSchema).readonly().nullable(),
  required: z.boolean(),
})

export const fieldDefInputSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: fieldKindSchema,
  options: z.array(fieldOptionSchema.partial({ colorToken: true })).readonly().nullable().optional(),
  required: z.boolean().optional(),
})

export type FieldDefInput = z.output<typeof fieldDefInputSchema>
export type FieldOptionInput = NonNullable<FieldDefInput["options"]>[number]

assertParity<z.output<typeof fieldDefSchema>, FieldDef>()
