import { z } from "zod"
import type { DiffCommitMode } from "./git-diff-types"
import { assertParity } from "./type-parity"

export const diffCommitModeSchema = z.enum(["commit_and_push", "commit_only"])

export const chatBranchRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local"), name: z.string() }),
  z.object({ kind: z.literal("remote"), name: z.string(), remoteRef: z.string() }),
  z.object({
    kind: z.literal("pull_request"),
    name: z.string(),
    prNumber: z.number(),
    headRefName: z.string(),
    headRepoCloneUrl: z.string().optional(),
    isCrossRepository: z.boolean().optional(),
    remoteRef: z.string().optional(),
  }),
])

export const gitSyncActionSchema = z.enum(["fetch", "pull", "push", "publish"])

assertParity<z.output<typeof diffCommitModeSchema>, DiffCommitMode>()
