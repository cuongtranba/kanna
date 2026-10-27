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
} from "./types"
import { CLEANUP_DECISIONS } from "./worktree-cleanup"

export const boardOwnerKindSchema = z.enum(BOARD_OWNER_KINDS)
export const columnSemanticSchema = z.enum(COLUMN_SEMANTICS)
export const columnColorTokenSchema = z.enum(COLUMN_COLOR_TOKENS)
export const syncDirectionSchema = z.enum(SYNC_DIRECTIONS)
export const cleanupDecisionSchema = z.enum(CLEANUP_DECISIONS)
export const fieldKindSchema = z.enum(FIELD_KINDS)
export const remoteKindSchema = z.enum(REMOTE_KINDS)
export const conflictResolutionSchema = z.enum(CONFLICT_RESOLUTIONS)
export const cardLinkKindSchema = z.enum(CARD_LINK_KINDS)
