import { z } from "zod"
import type { BoardOwnerKind, ColumnColorToken, ColumnSemantic, SyncDirection } from "./types"
import { COLUMN_COLOR_TOKENS } from "./types"
import type { CleanupDecision } from "./worktree-cleanup"
import { assertParity } from "../type-parity"

export const boardOwnerKindSchema = z.enum(["project", "stack"])
export const columnSemanticSchema = z.enum(["start", "active", "review", "done"])
export const columnColorTokenSchema = z.enum(COLUMN_COLOR_TOKENS)
export const syncDirectionSchema = z.enum(["pull", "push", "both"])
export const cleanupDecisionSchema = z.enum(["merge", "discard", "leave"])

assertParity<z.output<typeof boardOwnerKindSchema>, BoardOwnerKind>()
assertParity<z.output<typeof columnSemanticSchema>, ColumnSemantic>()
assertParity<z.output<typeof columnColorTokenSchema>, ColumnColorToken>()
assertParity<z.output<typeof syncDirectionSchema>, SyncDirection>()
assertParity<z.output<typeof cleanupDecisionSchema>, CleanupDecision>()
