import { z } from "zod"
import { gitWorktreeSchema } from "../../git-diff-types.schema"
import type { ImportSessionsByIdsResult, ProjectDeleteResult, TerminalSnapshot } from "../../protocol"
import { assertParity } from "../../type-parity"

export const projectIdResultSchema = z.object({ projectId: z.string() })

export const projectDeleteResultSchema = z.object({
  deletedBoardIds: z.array(z.string()),
  failures: z.array(z.string()),
})

export const importClaudeSessionsResultSchema = z.object({
  imported: z.number(),
  updated: z.number(),
  skipped: z.number(),
  failed: z.number(),
  newProjects: z.number(),
})

export type ImportClaudeSessionsResult = z.output<typeof importClaudeSessionsResultSchema>

export const importSessionsByIdsResultSchema = z.object({
  results: z.array(z.object({
    sessionId: z.string(),
    status: z.enum(["created", "updated", "skipped", "failed"]),
    chatId: z.string().optional(),
    title: z.string().optional(),
    error: z.enum(["invalid_id", "not_found", "cwd_missing", "parse_failed", "store_error"]).optional(),
  })),
  newProjects: z.number(),
})

export const stackIdResultSchema = z.object({ stackId: z.string() })

export const stackWorktreesResultSchema = z.object({ worktrees: z.array(gitWorktreeSchema) })

export const terminalSnapshotSchema = z.object({
  terminalId: z.string(),
  title: z.string(),
  cwd: z.string(),
  shell: z.string(),
  cols: z.number(),
  rows: z.number(),
  scrollback: z.number(),
  serializedState: z.string(),
  status: z.enum(["running", "exited"]),
  exitCode: z.number().nullable(),
  signal: z.number().optional(),
})

assertParity<z.output<typeof projectDeleteResultSchema>, ProjectDeleteResult>()
assertParity<z.output<typeof importSessionsByIdsResultSchema>, ImportSessionsByIdsResult>()
assertParity<z.output<typeof terminalSnapshotSchema>, TerminalSnapshot>()
